const params = new URLSearchParams(location.search);
const site = OptiCore.normalizeDomain(params.get('site') || '') || 'this site';
document.getElementById('site').textContent = site;

chrome.storage.local.get(['usage', 'sites']).then(({ usage, sites }) => {
  const used = usage && usage.seconds ? usage.seconds[site] || 0 : 0;
  const cfg = (sites || []).find((s) => s.domain === site);
  if (cfg) {
    document.getElementById('usage').textContent =
      `Today: ${OptiCore.formatDuration(used)} used of your ${cfg.limitMinutes}-minute limit.`;
  }
});

document.getElementById('newtab').addEventListener('click', () => {
  chrome.tabs.update({ url: 'chrome://newtab' });
});
document.getElementById('close').addEventListener('click', () => {
  chrome.tabs.getCurrent().then((tab) => tab && chrome.tabs.remove(tab.id));
});
