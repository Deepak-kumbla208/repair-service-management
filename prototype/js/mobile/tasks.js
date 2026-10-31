// Phone: Tasks — the Approver's counter-checks and payment-term approvals, and the Operations Executive's
// leave-site confirmations. Same tasks and decisions as the web "My tasks" page.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, toast, fmtDuration } from '../core/ui.js';
import { myTasks } from '../core/workflow.js';
import { bindMics } from '../core/capture.js';
import { taskDetail, actOnTask, taskLabel } from '../web/tasks.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const taskCard = t => html`<a class="job-card" href="#/m/task/${t.id}" style="display:block;color:inherit;text-decoration:none">
  <div class="row"><span class="pill ${t.kind === 'leaveSite' ? 'amber' : 'blue'}">${taskLabel(t)}</span><span class="grow"></span><span class="small muted">${fmtDuration(Date.now() - new Date(t.createdAt))} ago</span></div>
  <div class="strong" style="margin-top:6px">${t.docNo}</div><div class="muted">${t.customer}</div>
  ${t.amount != null ? html`<div><b>${auth.company().currency} ${m2(t.amount)}</b></div>` : ''}</a>`;

export function mTasks(page) {
  page.setTitle('Tasks');
  const list = myTasks();
  page.body.innerHTML = String(list.length ? html`<div class="m-section" style="margin-top:0">Waiting for you (${list.length})</div>${list.map(taskCard)}`
    : html`<div class="empty">Nothing is waiting for you.</div>`);
}

export function mTask(page, id) {
  const t = store.get('tasks', id);
  page.setTitle(t ? t.docNo : 'Task', 'm/tasks');
  if (!t || t.status !== 'Open') { page.body.innerHTML = '<div class="empty">This task is already done.</div>'; return; }
  page.body.innerHTML = String(html`<div class="m-phone-task">${taskDetail(t, { compact: true })}</div>`);
  bindMics(page.body);
  page.body.onclick = e => {
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const err = actOnTask(t, b.dataset.do, $('[name="comment"]', page.body)?.value || '');
    if (err) { toast(err, 'bad'); return; }
    toast(`${t.docNo}: ${b.dataset.do === 'return' ? 'returned' : b.dataset.do === 'confirm' ? 'technician may leave' : 'approved'}`);
    go('m/tasks');
  };
}
