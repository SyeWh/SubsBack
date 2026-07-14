// ─────────────────────────────────────────────────────────────
//  PUT YOUR PAYPAL LINK HERE  (paypal.me link or donate URL)
// ─────────────────────────────────────────────────────────────
const PAYPAL_URL = 'https://paypal.me/Sye';
const X_URL = 'https://x.com/sye_white';

const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const donate = document.getElementById('donate');
const creator = document.getElementById('creator');

donate.href = PAYPAL_URL;
creator.href = X_URL;

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => render(enabled));

toggle.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
  render(toggle.checked);
});

function render(on) {
  toggle.checked = on;
  status.textContent = on ? 'Enabled' : 'Disabled';
  status.classList.toggle('off', !on);
}
