// Keyboard and labels on every page (UX audit, finding 26), applied by the web shell after each draw so every screen
// gets them without each page repeating the same code:
//   - an input with no label of its own is named after its field label, or its column heading and row;
//   - the first cell of a list row that opens a page is a real link (keyboard, "open in new tab");
//   - a row that selects something on the page can be reached with Tab and chosen with Enter.
const named = el => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
const text = el => (el?.textContent || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();

export function labelInputs(root) {
  root.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea').forEach(el => {
    if (named(el)) return;
    let name = '';
    const field = el.closest('.field');
    if (field) name = text(field.querySelector(':scope > label, :scope > .field-label'));
    const td = !name && el.closest('td');
    if (td) {
      const tr = td.parentElement, table = td.closest('table');
      const head = table?.querySelector('thead tr')?.children[[...tr.children].indexOf(td)];
      const first = tr.children[0] !== td ? text(tr.children[0]).slice(0, 40) : '';
      name = [text(head), first].filter(Boolean).join(', ');
      if (!name) name = `Row ${[...tr.parentElement.children].indexOf(tr) + 1}`;
    }
    if (!name) name = el.placeholder || text(el.closest('.card')?.querySelector('h2, h3')) || el.name || 'Field';
    if (el.type === 'radio' || el.type === 'checkbox') { const s = text(el.nextElementSibling); if (s) name = `${name}: ${s}`; }
    el.setAttribute('aria-label', name.slice(0, 90));
  });
}

export function linkRows(root, route) {
  root.querySelectorAll('tr.click:not([data-linked])').forEach(tr => {
    tr.dataset.linked = '1';
    const cell = tr.children[0];
    if (!cell || tr.querySelector('a.rowlink')) return;
    const to = tr.dataset.go || (tr.dataset.id && /^(assessments|master\/[^/]+)$/.test(route) ? `${route}/${tr.dataset.id}` : '');
    if (to && !cell.querySelector('a, button, input, select')) {
      const a = document.createElement('a');
      a.className = 'rowlink'; a.href = `#/${to}`;
      while (cell.firstChild) a.appendChild(cell.firstChild);
      cell.appendChild(a);
      return;
    }
    // A row that selects on the page (a user, a rule, a size set): reachable with Tab, chosen with Enter or Space.
    if (!tr.querySelector('a, button')) {
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.addEventListener('keydown', e => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); } });
    }
  });
  // Cards and tiles that act on a click but are not buttons.
  root.querySelectorAll('.task[data-task]:not([tabindex]), .jobc:not([tabindex]):not(a), .vbars > div:not([tabindex]), .hb.click:not([tabindex]), .kv .click:not([tabindex]):not(button), td[data-month]:not([tabindex])').forEach(el => {
    el.tabIndex = 0;
    if (!el.getAttribute('role')) el.setAttribute('role', 'button');
    el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); } });
  });
}
