// SubsBack for YouTube — restores the subscriber count under the channel name on watch pages.
// How it works: grabs the channel link from the video owner row, fetches that channel's page
// (same-origin fetch, cached per channel), pulls the "X subscribers" text out of the page data,
// and injects it right under the channel name — styled like YouTube's own secondary text.

(() => {
  const BADGE_ID = 'subsback-count';
  const cache = new Map(); // channelUrl -> "15.1M subscribers"
  let enabled = true;
  let token = 0; // guards against stale async writes when navigating fast

  init();

  function init() {
    chrome.storage.sync.get({ enabled: true }, (v) => {
      enabled = !!v.enabled;
      if (enabled) update();
    });

    // React instantly to the popup toggle
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.enabled) return;
      enabled = !!changes.enabled.newValue;
      if (enabled) update();
      else removeBadge();
    });

    // YouTube is a SPA — this fires on every in-app navigation
    window.addEventListener('yt-navigate-finish', update);

    // Cheap safety net: re-inject if YouTube re-renders the owner row and wipes our badge
    setInterval(guard, 2000);
  }

  const isWatch = () => location.pathname === '/watch';

  const getOwner = () =>
    document.querySelector(
      'ytd-watch-metadata ytd-video-owner-renderer, #owner ytd-video-owner-renderer, ytd-video-owner-renderer'
    );

  const getChannelLink = (owner) =>
    owner &&
    owner.querySelector('#channel-name a[href], a[href^="/@"], a[href*="/channel/"]');

  function removeBadge() {
    const el = document.getElementById(BADGE_ID);
    if (el) el.remove();
  }

  function guard() {
    if (!enabled || !isWatch()) return;
    const owner = getOwner();
    const link = getChannelLink(owner);
    if (!link) return;
    const badge = document.getElementById(BADGE_ID);
    if (!badge || badge.dataset.channel !== link.href) update();
  }

  async function update() {
    if (!enabled || !isWatch()) {
      removeBadge();
      return;
    }
    const my = ++token;

    const owner = await waitFor(getOwner, 12000);
    if (!owner || my !== token || !enabled) return;

    const link = getChannelLink(owner);
    if (!link || !link.href) return;
    const channelUrl = link.href;

    // If YouTube itself is showing a count, don't duplicate it.
	const native = owner.querySelector('#owner-sub-count');

	if (native) {
	  const rect = native.getBoundingClientRect();
	  const style = getComputedStyle(native);
	  const nativeText = native.textContent?.trim();

	  const isVisible =
		rect.height > 5 &&
		rect.width > 5 &&
		style.visibility !== 'hidden' &&
		style.display !== 'none';

	  if (isVisible) {
		removeBadge();
		return;
	  }

	  // YouTube has the count but hides it.
	  if (nativeText) {
		place(owner, channelUrl, nativeText);
		return;
	  }
	}

    // Already showing the right badge for this channel? Done.
    const existing = document.getElementById(BADGE_ID);
    if (existing && existing.dataset.channel === channelUrl && existing.textContent) return;

    const text = await getSubs(channelUrl);
    if (my !== token || !enabled || !text || !isWatch()) return;

    const ownerNow = getOwner();
    if (ownerNow) place(ownerNow, channelUrl, text);
  }

  function place(owner, channelUrl, text) {
    removeBadge();
    const el = document.createElement('div');
    el.id = BADGE_ID;
    el.dataset.channel = channelUrl;
    el.textContent = text;
    el.style.cssText =
      'font-family:Roboto,Arial,sans-serif;font-size:12px;line-height:18px;' +
      'color:var(--yt-spec-text-secondary,#aaa);margin-top:1px;white-space:nowrap;';
    const nameEl = owner.querySelector('#channel-name') || owner.querySelector('ytd-channel-name');
    const info = owner.querySelector('#upload-info');
    if (nameEl && nameEl.parentElement) {
      nameEl.parentElement.insertBefore(el, nameEl.nextSibling);
    } else if (info) {
      info.appendChild(el);
    } else {
      owner.appendChild(el);
    }
  }

  async function getSubs(channelUrl) {
    if (cache.has(channelUrl)) return cache.get(channelUrl);
    try {
      const res = await fetch(channelUrl, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const html = await res.text();
      const text = extract(html);
      if (text) cache.set(channelUrl, text);
      return text;
    } catch {
      return null;
    }
  }

  // Pulls the localized "15.1M subscribers" string out of the channel page HTML.
  // Tries the most specific data shapes first, then falls back to a generic scan.
  function extract(html) {
    // 1) Classic header object: "subscriberCountText":{...,"simpleText":"15.1M subscribers"}
    let m = html.match(/"subscriberCountText":\{.{0,300}?"simpleText":"((?:[^"\\]|\\.)+)"/s);
    if (m) return clean(m[1]);

    // 2) Plain string form used by newer view-models
    m = html.match(/"subscriberCountText":"((?:[^"\\]|\\.)+)"/);
    if (m) return clean(m[1]);

    // 3) Generic scan: any short "content"/"simpleText"/"label" string that contains a
    //    number + a "subscribers" word (covers several UI languages).
    const word =
      '(?:subscribers?|abonn\\u00e9s?|abonnes?|suscriptores|Abonnenten|iscritti|inscritos|abonnees|abone|\\u043f\\u043e\\u0434\\u043f\\u0438\\u0441\\u0447\\u0438\\u043a\\w*|\\u0645\\u0634\\u062a\\u0631\\u0643[\\s\\S]{0,8})';
    const re = new RegExp(
      '"(?:content|simpleText|label)":"([^"\\\\]{0,50}?' + word + '[^"\\\\]{0,15})"',
      'gi'
    );
    const candidates = [];
    let g;
    while ((g = re.exec(html)) && candidates.length < 40) {
      if (/\d/.test(g[1])) candidates.push(g[1]);
    }
    // Prefer strings shaped like "<number> <word>" (filters out video titles that
    // merely mention subscribers).
    const shaped = candidates.find((c) =>
      /^[\s\u200e\u200f]*\d[\d.,\u00a0\u202f\s]*[A-Za-z]?\s?\S+(\s\S+)?$/u.test(c.trim())
    );
    const pick = shaped || candidates[0];
    return pick ? clean(pick) : null;
  }

  function clean(s) {
    return s
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\\//g, '/')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function waitFor(fn, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function poll() {
        const v = fn();
        if (v) return resolve(v);
        if (Date.now() - started > timeout) return resolve(null);
        setTimeout(poll, 250);
      })();
    });
  }
})();
