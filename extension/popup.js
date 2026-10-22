const { normalizeDomain, addSite, removeSite, formatDuration, dayKey } = OptiCore;
const $ = (id) => document.getElementById(id);

let state = { sites: [], usage: { date: dayKey(), seconds: {} }, enabled: true };

async function load() {
  const data = await chrome.storage.local.get(['sites', 'usage', 'enabled']);
  const usage = data.usage && data.usage.date === dayKey() ? data.usage : { date: dayKey(), seconds: {} };
  state = { sites: data.sites || [], usage, enabled: data.enabled !== false };
  render();
}

function render() {
  $('enabled').checked = state.enabled;
  $('empty').hidden = state.sites.length > 0;
  $('status').textContent = state.enabled
    ? 'Blocking is on. Limits reset at midnight.'
    : 'Blocking is paused.';

  const list = $('sites');
  list.innerHTML = '';
  for (const site of state.sites) {
    const used = state.usage.seconds[site.domain] || 0;
    const limitSec = site.limitMinutes * 60;
    const blocked = used >= limitSec;
    const pct = limitSec === 0 ? 100 : Math.min(100, (used / limitSec) * 100);

    const li = document.createElement('li');
    if (blocked) li.classList.add('blocked');

    const top = document.createElement('div');
    top.className = 'row';
    const name = document.createElement('strong');
    name.textContent = site.domain; // textContent: safe against HTML injection
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = 'Remove';
    del.setAttribute('aria-label', `Remove ${site.domain}`);
    del.addEventListener('click', async () => {
      await chrome.storage.local.set({ sites: removeSite(state.sites, site.domain) });
    });
    top.append(name, del);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = blocked
      ? `Blocked. Used ${formatDuration(used)} of ${site.limitMinutes}m`
      : `${formatDuration(used)} of ${site.limitMinutes}m used`;

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    li.append(top, meta, bar);
    list.appendChild(li);
  }
}

async function add(domainInput, limit) {
  $('error').textContent = '';
  const result = addSite(state.sites, domainInput, limit);
  if (result.error) {
    $('error').textContent = result.error;
    return false;
  }
  await chrome.storage.local.set({ sites: result.sites });
  return true;
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await add($('domain').value, $('limit').value)) $('domain').value = '';
});

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
});

// "Add this site" shortcut for the tab the person is on.
(async function setupCurrentTab() {
  const btn = $('add-current');
  btn.hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/i.test(tab.url || '')) return;
    const domain = normalizeDomain(new URL(tab.url).hostname);
    if (!domain || state.sites.some((s) => s.domain === domain)) return;
    btn.textContent = `Add ${domain} with the limit above`;
    btn.hidden = false;
    btn.addEventListener('click', () => add(domain, $('limit').value));
  } catch (_) { /* no tab access; ignore */ }
})();

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') load();
});

load();
setInterval(load, 5000); // keep the usage bars fresh while the popup is open
