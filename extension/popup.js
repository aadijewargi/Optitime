const { normalizeDomain, addSite, removeSite, dayKey } = OptiCore;
const $ = (id) => document.getElementById(id);

const MAX_LIVE_SECONDS = 90; // mirrors the cap in background.js

let state = { sites: [], usage: { date: dayKey(), seconds: {} }, enabled: true, tracking: null };

async function load() {
  const data = await chrome.storage.local.get(['sites', 'usage', 'enabled', 'tracking']);
  const usage = data.usage && data.usage.date === dayKey() ? data.usage : { date: dayKey(), seconds: {} };
  state = { sites: data.sites || [], usage, enabled: data.enabled !== false, tracking: data.tracking || null };
  render();
}

// Saved usage only updates every ~30s, so add the time since the last save for
// the site being tracked right now. That makes the popup tick live.
function liveSeconds(domain) {
  let used = state.usage.seconds[domain] || 0;
  const t = state.tracking;
  if (state.enabled && t && t.domain === domain) {
    used += Math.min(Math.max((Date.now() - t.at) / 1000, 0), MAX_LIVE_SECONDS);
  }
  return used;
}

/** 75 -> "1:15", 3725 -> "1:02:05" */
function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// Rows are built once per change to the site list and then updated in place,
// so the per-second refresh never replaces a button mid-click.
let rows = new Map(); // domain -> { li, meta, fill }
let rowsKey = '';

function buildRows() {
  const list = $('sites');
  list.innerHTML = '';
  rows = new Map();
  for (const site of state.sites) {
    const li = document.createElement('li');

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
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    bar.appendChild(fill);

    li.append(top, meta, bar);
    list.appendChild(li);
    rows.set(site.domain, { li, meta, fill });
  }
}

function render() {
  $('enabled').checked = state.enabled;
  $('empty').hidden = state.sites.length > 0;
  const tracked = state.enabled && state.tracking && state.tracking.domain;
  $('status').textContent = !state.enabled
    ? 'Blocking is paused.'
    : tracked
      ? `Timing ${state.tracking.domain} right now. Limits reset at midnight.`
      : 'Blocking is on. Limits reset at midnight.';

  const key = state.sites.map((s) => `${s.domain}:${s.limitMinutes}`).join('|');
  if (key !== rowsKey) {
    rowsKey = key;
    buildRows();
  }

  for (const site of state.sites) {
    const row = rows.get(site.domain);
    if (!row) continue;
    const used = liveSeconds(site.domain);
    const limitSec = site.limitMinutes * 60;
    const blocked = used >= limitSec;
    const pct = limitSec === 0 ? 100 : Math.min(100, (used / limitSec) * 100);
    row.li.classList.toggle('blocked', blocked);
    row.meta.textContent = blocked
      ? `Blocked. Used ${clock(Math.min(used, limitSec))} of ${site.limitMinutes} min`
      : `${clock(used)} used of ${site.limitMinutes} min`;
    row.fill.style.width = `${pct}%`;
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
setInterval(render, 1000); // live-updating numbers and bars while the popup is open
