// Company Setup → "Working style" (UX audit, wave 3). The four changes that touch the team lead's menu
// list or flow steps, each with a switch: on is the new way, off is exactly the old behaviour. A switch saves at once.
import * as auth from '../core/auth.js';
import { html, $, $$, toast, fieldError } from '../core/ui.js';
import { ux, saveUx, UX_SWITCHES } from '../core/ux.js';

export function styleCard(edit) {
  const u = ux();
  return html`<div class="card" id="uxCard"><div class="card-head"><h2>Working style</h2></div>
    <p class="muted" style="margin:0 0 8px">Four changes from the UI / UX audit that alter the menu list or a step of the flow. Each can be switched back to how it was; a switch saves at once and applies to everyone in ${auth.company().name}.</p>
    <table class="tbl"><thead><tr><th style="width:26%">Change</th><th style="width:150px">Now</th><th>What it does</th></tr></thead><tbody>
      ${UX_SWITCHES.map(s => html`<tr><td><b>${s.label}</b></td>
        <td><span class="chips" role="radiogroup" aria-label="${s.label}">${[['1', 'On'], ['0', 'Off']].map(([v, l]) => html`<label class="chip"><input type="radio" name="ux_${s.key}" value="${v}" ${(u[s.key] ? '1' : '0') === v ? 'checked' : ''} ${edit ? '' : 'disabled'}><span>${l}</span></label>`)}</span></td>
        <td>${u[s.key] ? s.on : s.off}<div class="small muted">${u[s.key] ? `Off: ${s.off}` : `On: ${s.on}`}</div>
          ${s.key === 'approvalByRule' ? html`<div class="field" style="margin-top:6px;max-width:320px"><label for="uxLimit" class="small">Approval limit (total with tax, ${auth.company().currency})</label>
            <input type="number" id="uxLimit" min="0" step="100" value="${u.approvalLimit}" ${edit && u.approvalByRule ? '' : 'disabled'}></div>` : ''}</td></tr>`)}
    </tbody></table></div>`;
}

export function bindStyle(el, redraw) {
  const card = $('#uxCard', el);
  if (!card) return;
  $$('input[type=radio]', card).forEach(r => r.addEventListener('change', e => {
    e.stopPropagation();
    const key = r.name.slice(3), on = r.value === '1';
    saveUx({ [key]: on });
    toast(`${UX_SWITCHES.find(s => s.key === key).label}: ${on ? 'on' : 'off (as it was before)'}`);
    redraw();
  }));
  $('#uxLimit', card)?.addEventListener('change', e => {
    e.stopPropagation();
    const n = Number(e.target.value);
    if (!(n >= 0) || e.target.value === '') return fieldError(e.target, 'Enter an amount, 0 or more.');
    saveUx({ approvalLimit: n });
    toast(`Approval limit: quotations over ${n.toLocaleString('en-SG')} go to the Approver`);
  });
  // The switches save themselves: they are not part of the Save button's form.
  card.addEventListener('input', e => e.stopPropagation());
}
