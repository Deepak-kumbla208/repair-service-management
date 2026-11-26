// Drag and drop on a scheduling board (UX audit, finding 18), with the browser's own drag events.
// A [data-drag] element is picked up; every [data-day] cell is then marked as able to take it or not, with a short
// reason in the cell, and the board is told which day is under the pointer so it can say why in full. Letting go on
// a day that can take it calls drop(); on a day that cannot, refuse(). Nothing is changed here: the board decides.
//   item(src)            what is dragged for that element, or null when it may not be dragged now
//   check(item, cell)    { ok, tag, why, … } for one day cell (asked once per cell and drag)
//   start(item) / end()  the drag began / is over (marks are already cleared at end)
//   over(item, cell, verdict)   the pointer is on that day (cell is null between days)
//   drop(item, cell, verdict) / refuse(item, cell, verdict)
import { fieldError } from '../core/ui.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Thu 3 Dec" for 2026-12-03, and the same inside a sentence that came with dates as 2026-12-03.
export const dayText = ds => { const d = new Date(`${ds}T00:00`); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const sayDates = text => String(text).replace(/\b\d{4}-\d\d-\d\d\b/g, dayText);

// A few words for the day cell, from the sentence the scheduling rules gave (the sentence itself is shown in full
// beside the board).
const TAGS = [
  [/offline/i, 'Phone offline'], [/returned the payment term/i, 'Term returned'], [/must approve/i, 'Waiting for approval'],
  [/today or a later/i, 'Day passed'], [/already passed/i, 'Too late today'], [/not ready before (\d{4}-\d\d-\d\d)/i, m => `Parts from ${dayText(m[1]).replace(/^\w+ /, '')}`],
  [/not a working day/i, 'Day off'], [/already has/i, 'Booked'], [/free time/i, 'No free time'],
  [/not active/i, 'Contract not active'], [/already started/i, 'Already started'],
];
export function tagOf(why) {
  for (const [re, tag] of TAGS) { const m = String(why).match(re); if (m) return typeof tag === 'function' ? tag(m) : tag; }
  return 'Not possible';
}

// A refusal from the scheduling rules inside a dialog: in red under the field it is about (or at the end of the
// form, in its [data-end] place, when it is about no single field).
export function problemInForm(body, text, timeName = 'time') {
  const name = /Pick a technician/.test(text) ? 'technicianId' : /already has|start time/.test(text) ? timeName : /\bdate\b|Parts are|working day/.test(text) ? 'date' : '';
  return fieldError(body.querySelector(name ? `[name="${name}"]` : '[data-end]'), sayDates(text));
}

const elOf = t => (t?.nodeType === 1 ? t : t?.parentElement);

export function bindBoardDrag(root, { item, check, start, end, over, drop, refuse }) {
  if (!root) return;
  let drag = null; // { item, src, verdicts, cell }
  const cellOf = e => { const c = elOf(e.target)?.closest?.('[data-day]'); return c && root.contains(c) ? c : null; };
  const verdictOf = c => { if (!drag.verdicts.has(c)) drag.verdicts.set(c, check(drag.item, c)); return drag.verdicts.get(c); };
  const mark = c => { const v = verdictOf(c); c.classList.add(v.ok ? 'drop-ok' : 'drop-no'); c.dataset.tag = v.tag || ''; };
  // The day under the pointer, followed over the whole page, so a release outside the board is not taken for a day.
  const track = e => {
    if (!drag) return;
    const c = cellOf(e);
    if (c !== drag.cell) {
      drag.cell?.classList.remove('drop-over');
      drag.cell = c;
      c?.classList.add('drop-over');
      over?.(drag.item, c, c ? verdictOf(c) : null);
    }
    // Only a day that can take it accepts the drop; on the others the browser shows its "not allowed" pointer.
    if (c && verdictOf(c).ok) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }
  };
  const finish = () => {
    document.removeEventListener('dragenter', track);
    document.removeEventListener('dragover', track);
    root.classList.remove('dragging');
    root.querySelectorAll('.drag-src').forEach(x => x.classList.remove('drag-src'));
    root.querySelectorAll('[data-day]').forEach(c => { c.classList.remove('drop-ok', 'drop-no', 'drop-over'); c.removeAttribute('data-tag'); });
    drag = null;
    end?.();
  };

  root.ondragstart = e => {
    const src = elOf(e.target)?.closest?.('[data-drag]');
    if (!src || !root.contains(src)) return;
    const it = item(src);
    if (!it) { e.preventDefault(); return; }
    if (drag) finish();
    const mine = drag = { item: it, src, verdicts: new Map(), cell: null };
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', src.dataset.drag); }
    document.addEventListener('dragenter', track);
    document.addEventListener('dragover', track);
    // The marks are drawn after the browser has taken its picture of the dragged card.
    setTimeout(() => {
      if (drag !== mine) return;
      root.classList.add('dragging');
      src.classList.add('drag-src');
      root.querySelectorAll('[data-day]').forEach(mark);
      start?.(it);
    }, 0);
  };
  root.ondrop = e => {
    const c = drag && cellOf(e);
    if (!c) return;
    e.preventDefault();
    const it = drag.item, v = verdictOf(c);
    finish();
    (v.ok ? drop : refuse)?.(it, c, v);
  };
  // Let go without a drop: on a day that cannot take it (the browser sends no drop there), or outside the days.
  root.ondragend = () => {
    if (!drag) return;
    const it = drag.item, c = drag.cell, v = c ? verdictOf(c) : null;
    finish();
    if (c && !v.ok) refuse?.(it, c, v);
  };
}
