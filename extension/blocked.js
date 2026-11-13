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

// Show what's left on the to-do list, so the block page points somewhere useful.
// Items can be ticked off here too; the popup sees the change straight away.
const MAX_SHOWN = 5;
const shownDone = []; // ids ticked off on this page

function renderTodos(todos) {
  const all = todos || [];
  const open = all.filter((t) => !t.done);
  // Items ticked on this page stay in place (struck through) so nothing jumps mid-click.
  const items = all
    .filter((t) => (!t.done && open.indexOf(t) < MAX_SHOWN) || (t.done && shownDone.includes(t.id)));
  const card = document.getElementById('todo-card');
  card.hidden = items.length === 0;
  const list = document.getElementById('todos');
  list.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.classList.toggle('done', item.done);
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = item.done;
    check.addEventListener('change', async () => {
      if (!shownDone.includes(item.id)) shownDone.push(item.id);
      check.disabled = true; // one write per click
      const { todos: latest } = await chrome.storage.local.get('todos');
      await chrome.storage.local.set({ todos: OptiCore.toggleTodo(latest || [], item.id) });
    });
    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = item.text;
    label.append(check, text);
    li.appendChild(label);
    list.appendChild(li);
  }
  const more = open.length - MAX_SHOWN;
  document.getElementById('todo-more').textContent =
    more > 0 ? `+ ${more} more in the OptiTime popup` : '';
}

chrome.storage.local.get('todos').then(({ todos }) => renderTodos(todos));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.todos) renderTodos(changes.todos.newValue);
});
