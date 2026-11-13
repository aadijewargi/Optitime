/*
 * Popup tabs and the to-do list.
 *
 * The list lives in chrome.storage.local under "todos", so it is shared with
 * the "Time's up" page and survives browser restarts. Each change reads the
 * latest list first, so two open pages can't overwrite each other's edits.
 */
(function () {
  const {
    addTodo, toggleTodo, editTodo, removeTodo, clearDoneTodos, moveTodo, sortTodos, todoCounts,
  } = OptiCore;
  const $ = (id) => document.getElementById(id);

  // ---- tabs ----
  const tabs = [...document.querySelectorAll('.tab')];

  function showTab(name, focus) {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    }
    if (name === 'todo' && !focus) $('todo-text').focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      showTab(tab.dataset.tab);
      chrome.storage.local.set({ popupTab: tab.dataset.tab });
    });
    // Arrow keys move between tabs, as screen-reader users expect.
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      showTab(next.dataset.tab, true);
      chrome.storage.local.set({ popupTab: next.dataset.tab });
    });
  });

  // ---- to-do state ----
  let todos = [];

  async function update(change) {
    const { todos: latest } = await chrome.storage.local.get('todos');
    const result = change(latest || []);
    if (result && result.error) {
      $('todo-error').textContent = result.error;
      return false;
    }
    $('todo-error').textContent = '';
    await chrome.storage.local.set({ todos: Array.isArray(result) ? result : result.todos });
    return true;
  }

  $('todo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('todo-text');
    if (await update((list) => addTodo(list, input.value))) input.value = '';
    input.focus();
  });

  $('clear-done').addEventListener('click', () => update(clearDoneTodos));

  function button(label, aria, onClick, className = 'icon-btn') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  }

  function startEditing(li, item, textEl) {
    const input = document.createElement('input');
    input.className = 'todo-edit';
    input.value = item.text;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Rename to-do');
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      if (save && input.value.trim() !== item.text) {
        if (!(await update((list) => editTodo(list, item.id, input.value)))) {
          finished = false; // keep the box open so the person can fix it
          input.focus();
          return;
        }
      } else {
        input.replaceWith(textEl);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') { e.preventDefault(); $('todo-error').textContent = ''; finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    textEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function render() {
    const ordered = sortTodos(todos);
    const counts = todoCounts(todos);
    const openIds = ordered.filter((t) => !t.done).map((t) => t.id);

    const badge = $('todo-badge');
    badge.textContent = String(counts.open);
    badge.hidden = counts.open === 0;

    $('todo-empty').hidden = counts.total > 0;
    $('todo-hint').hidden = counts.total === 0;
    $('todo-summary').textContent = counts.total === 0
      ? ''
      : counts.open === 0
        ? `All ${counts.done} done. Nice work!`
        : `${counts.open} to go${counts.done ? `, ${counts.done} done` : ''}`;

    const clear = $('clear-done');
    clear.hidden = counts.done === 0;
    clear.textContent = `Clear ${counts.done} finished`;

    const list = $('todos');
    list.innerHTML = '';
    for (const item of ordered) {
      const li = document.createElement('li');
      li.classList.toggle('done', item.done);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = item.done;
      check.setAttribute('aria-label', `${item.done ? 'Mark not done' : 'Mark done'}: ${item.text}`);
      check.addEventListener('change', () => update((l) => toggleTodo(l, item.id)));

      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = item.text; // textContent: safe against HTML injection
      text.title = 'Double-click to rename';
      text.addEventListener('dblclick', () => startEditing(li, item, text));

      const actions = document.createElement('span');
      actions.className = 'todo-actions';
      if (!item.done) {
        const pos = openIds.indexOf(item.id);
        const up = button('↑', `Move up: ${item.text}`, () => update((l) => moveTodo(l, item.id, -1)));
        const down = button('↓', `Move down: ${item.text}`, () => update((l) => moveTodo(l, item.id, 1)));
        up.disabled = pos === 0;
        down.disabled = pos === openIds.length - 1;
        actions.append(up, down);
      }
      actions.append(button('×', `Delete: ${item.text}`, () => update((l) => removeTodo(l, item.id)), 'icon-btn delete'));

      li.append(check, text, actions);
      list.appendChild(li);
    }
  }

  async function load() {
    const data = await chrome.storage.local.get(['todos']);
    todos = data.todos || [];
    render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.todos) {
      todos = changes.todos.newValue || [];
      render();
    }
  });

  chrome.storage.local.get('popupTab').then(({ popupTab }) => {
    showTab(popupTab === 'sites' ? 'sites' : 'todo');
  });
  load();
})();
