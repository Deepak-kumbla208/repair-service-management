// List pages for estimates and quotations (shared list engine in doc-list.js).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, fmtDate, pill } from '../core/ui.js';
import { vsLabel } from '../core/lookups.js';
import { estimateSummary, canCreateFor } from '../core/estimates.js';
import { refreshExpiry } from '../core/quotations.js';
import { renderDocList } from './doc-list.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderEstimateList(el) {
  const waiting = store.list('enquiries', canCreateFor);
  renderDocList(el, {
    key: 'rsmEstList', crumb: 'Transactions › Estimation', title: 'Estimates',
    sub: waiting.length ? html`${waiting.length} enquir${waiting.length > 1 ? 'ies are' : 'y is'} waiting for an estimate: ${waiting.map((e, i) => html`${i ? ', ' : ''}<a href="#/enquiries/${e.id}">${e.no}</a>`)}` : 'Repair and AMC estimates with the team lead\'s tabs; revisions keep the same number.',
    placeholder: 'Search estimates: no, customer, site, enquiry',
    rows: () => store.list('estimates', e => e.status !== 'Superseded').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    tiles: [
      { key: 'draft', label: 'Being prepared', test: e => e.status === 'Draft', tone: 'warn' },
      { key: 'ret', label: 'Returned by the Approver', test: e => !!e.returnNote && e.status === 'Draft', tone: 'bad' },
      { key: 'quoted', label: 'Quoted', test: e => e.status === 'Quoted' },
    ],
    columns: [['Estimate No', e => `${e.no} Rev ${e.rev}`], ['Type', e => vsLabel('ENQ_TYPE', e.kind === 'AMC' ? e.jobType : 'REPAIR')], ['Date', e => fmtDate(e.header.date)], ['Customer', e => e.header.customer], ['Site', e => e.header.site],
      ['Costing', e => `${vsLabel('COSTING_LEVEL', e.costingLevel)}${e.costingLevel === 'LINE' ? ` · ${(e.kind === 'AMC' ? e.sites : e.lines).length} lines` : ''}`],
      [`Selling price (${auth.company().currency})`, e => m2(estimateSummary(e).subtotal), 'num'], ['Markup', e => `${estimateSummary(e).markupPct.toFixed(1)} %`, 'num'], ['Status', e => pill(e.status)]],
    search: e => [e.no, e.header.customer, e.header.site, store.get('enquiries', e.enquiryId)?.no], route: e => `estimates/${e.id}`,
    empty: 'No estimates yet. Open an inspected enquiry and click "Create estimate".',
  });
}

export function renderQuotationList(el) {
  refreshExpiry();
  const soon = q => { const d = (new Date(`${q.validUntil}T00:00`) - new Date()) / 86400000; return d >= -1 && d <= 2; };
  renderDocList(el, {
    key: 'rsmQtList', crumb: 'Transactions › Sales Quotation', title: 'Quotations', sub: 'Counter-checked by the Approver before they are sent; revisions keep the same number.',
    placeholder: 'Search quotations: no, customer, site, PO',
    rows: () => store.list('quotations', q => q.status !== 'Superseded').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    tiles: [
      { key: 'draft', label: 'Draft or returned', test: q => ['Draft', 'Returned'].includes(q.status), tone: 'warn' },
      { key: 'check', label: 'In counter-check', test: q => q.status === 'Submitted' },
      { key: 'send', label: 'Approved, to send', test: q => q.status === 'Approved', tone: 'warn' },
      { key: 'sent', label: 'Sent, waiting for the customer', test: q => q.status === 'Sent' },
      { key: 'exp', label: 'Expiring in 2 days', test: q => q.status === 'Sent' && soon(q), tone: 'bad' },
      { key: 'won', label: 'Accepted', test: q => q.status === 'Accepted' },
    ],
    columns: [['Quotation No', q => `${q.no} Rev ${q.rev}`], ['Date', q => fmtDate(q.date)], ['Customer', q => q.customer], ['Site', q => q.site], ['Payment term', q => vsLabel('PAYMENT_TERMS', q.paymentTerm)],
      [`Total (${auth.company().currency})`, q => m2(q.total), 'num'], ['Valid until', q => fmtDate(q.validUntil)], ['Status', q => pill(q.status === 'Submitted' ? 'In counter-check' : q.status)]],
    search: q => [q.no, q.customer, q.site, q.acceptance?.poNo, q.enquiryNo], route: q => `quotations/${q.id}`, empty: 'No quotations yet.',
  });
}
