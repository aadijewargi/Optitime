/*
 * OptiTime service worker.
 *
 * Every ~30s (and whenever the active tab/window changes) it:
 *   1. credits the elapsed time to the site you were just on,
 *   2. works out which site (if any) you're on now,
 *   3. rebuilds the blocking rules and kicks open tabs off blocked sites.
 *
 * Blocking uses declarativeNetRequest, so navigations to a blocked site are
 * redirected to blocked.html by the browser itself (even if this worker is
 * asleep). Counting only happens while Chrome is focused and you're not idle.
 */
importScripts('lib/core.js');

const { findSite, dayKey, computeBlocked } = OptiCore;

const ALARM = 'optitime-tick';
const MAX_CREDIT_SECONDS = 90; // never credit more than this per tick (sleep, crashes)
const IDLE_SECONDS = 60;
const BLOCK_PAGE = 'blocked.html';

// ---- storage helpers ----
async function getState() {
  const data = await chrome.storage.local.get(['sites', 'usage', 'enabled', 'tracking']);
  const today = dayKey();
  let usage = data.usage;
  if (!usage || usage.date !== today) usage = { date: today, seconds: {} };
  return {
    sites: data.sites || [],
    usage,
    enabled: data.enabled !== false,
    tracking: data.tracking || null,
  };
}

// Serialize ticks so overlapping events can't double count.
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn, fn).catch((err) => console.error('OptiTime error', err));
  return queue;
}

// ---- what is the user looking at right now? ----
async function currentSite(sites) {
  try {
    if ((await chrome.idle.queryState(IDLE_SECONDS)) !== 'active') return null;
    const win = await chrome.windows.getLastFocused();
    if (!win || !win.focused) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return null;
    const site = findSite(new URL(tab.url).hostname, sites);
    return site ? site.domain : null;
  } catch (_) {
    return null;
  }
}

// ---- blocking ----
function blockUrl(domain) {
  return chrome.runtime.getURL(`${BLOCK_PAGE}?site=${encodeURIComponent(domain)}`);
}

async function applyBlocking(state) {
  const blocked = state.enabled ? computeBlocked(state.sites, state.usage.seconds) : [];

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: blocked.map((domain, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { extensionPath: `/${BLOCK_PAGE}?site=${encodeURIComponent(domain)}` },
      },
      condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
    })),
  });

  // Rules only catch new navigations; move tabs that are already open.
  if (blocked.length) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url || !/^https?:/i.test(tab.url)) continue;
      const site = findSite(new URL(tab.url).hostname, state.sites);
      if (site && blocked.includes(site.domain)) {
        chrome.tabs.update(tab.id, { url: blockUrl(site.domain) }).catch(() => {});
      }
    }
  }
  await updateBadge(blocked.length);
}

async function updateBadge(blockedCount) {
  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  await chrome.action.setBadgeText({ text: blockedCount ? String(blockedCount) : '' });
}

// ---- main tick ----
async function tick() {
  const now = Date.now();
  const state = await getState();

  if (state.enabled && state.tracking && state.tracking.domain) {
    const elapsed = Math.min(Math.max((now - state.tracking.at) / 1000, 0), MAX_CREDIT_SECONDS);
    const seconds = state.usage.seconds;
    seconds[state.tracking.domain] = (seconds[state.tracking.domain] || 0) + elapsed;
  }

  const domain = state.enabled ? await currentSite(state.sites) : null;
  await chrome.storage.local.set({
    usage: state.usage,
    tracking: { domain, at: now },
  });
  await applyBlocking(state);
}

function scheduleTick() {
  return enqueue(tick);
}

// ---- wiring ----
async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM);
  if (!alarm) chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ tracking: null });
  await ensureAlarm();
  scheduleTick();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ tracking: null });
  await ensureAlarm();
  scheduleTick();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) scheduleTick();
});

chrome.tabs.onActivated.addListener(scheduleTick);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.status === 'complete') scheduleTick();
});
chrome.windows.onFocusChanged.addListener(scheduleTick);
chrome.idle.onStateChanged.addListener(scheduleTick);

// Re-apply immediately when the popup changes sites, limits, or the on/off switch.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.sites || changes.enabled)) scheduleTick();
});

ensureAlarm();
