// Menu catalogue, following the team lead's "Application Menu Structure" sheet.
// stretch: the build stretch that delivers the screen; menus above BUILT_STRETCH show a "coming" page
// (3.5 = Stretch 3 Part B: the admin screens, now built).
export const GROUPS = ['Dashboard', 'Master', 'Transactions', 'Admin Setup'];
export const BUILT_STRETCH = 3.5;

export const MENUS = [
  { key: 'dashboard', label: 'Dashboard', group: 'Dashboard', icon: '◧', route: 'home', stretch: 1 },

  { key: 'customer', label: 'Customer', group: 'Master', icon: '☷', route: 'master/customer', stretch: 1 },
  { key: 'employee', label: 'Employee / Technician', group: 'Master', icon: '☺', route: 'master/employee', stretch: 1 },
  { key: 'transport', label: 'Transport', group: 'Master', icon: '⛟', route: 'master/transport', stretch: 1 },
  { key: 'equipment', label: 'Equipment', group: 'Master', icon: '⚙', route: 'master/equipment', stretch: 1 },
  { key: 'labour', label: 'Labour', group: 'Master', icon: '⚒', route: 'master/labour', stretch: 1 },
  { key: 'product', label: 'Product', group: 'Master', icon: '▥', route: 'master/product', stretch: 1 },
  { key: 'item', label: 'Material/Item', group: 'Master', icon: '▣', route: 'master/item', stretch: 1 },
  { key: 'size', label: 'Product Size', group: 'Master', icon: '⬚', route: 'master/size', stretch: 1 },
  { key: 'uom', label: 'Unit of Measure', group: 'Master', icon: '⊿', route: 'master/uom', stretch: 1 },
  { key: 'valueset', label: 'Value Set Master', plain: 'Drop-down lists', group: 'Master', icon: '≡', route: 'master/valueset', stretch: 1 },
  { key: 'tax', label: 'Tax', group: 'Master', icon: '%', route: 'master/tax', stretch: 1 },
  { key: 'terms', label: 'Terms', group: 'Master', icon: '¶', route: 'master/terms', stretch: 1 },

  { key: 'enquiry', label: 'Sales Enquiry', plain: 'Enquiries', also: ['Enquiry register'], group: 'Transactions', icon: '✎', route: 'enquiries', stretch: 1 },
  { key: 'inspection', label: 'Job Assessment', plain: 'Job assessments', also: ['Job assessments'], group: 'Transactions', icon: '⌖', route: 'assessments', stretch: 1 },
  { key: 'estimation', label: 'Estimation', plain: 'Estimates', also: ['Estimates'], group: 'Transactions', icon: '∑', route: 'estimates', stretch: 2 },
  { key: 'quotation', label: 'Sales Quotation', plain: 'Quotations', also: ['Quotations'], group: 'Transactions', icon: '▤', route: 'quotations', stretch: 2 },
  { key: 'job', label: 'Job Execution', plain: 'Jobs and schedule', also: ['Scheduling board'], group: 'Transactions', icon: '⚑', route: 'jobs', stretch: 2 },
  { key: 'amcContract', label: 'AMC Contract', plain: 'Maintenance contracts (AMC)', also: ['AMC contracts'], group: 'Transactions', icon: '▦', route: 'contracts', stretch: 3 },
  { key: 'amcScheduling', label: 'AMC Scheduling', plain: 'Maintenance schedule (AMC)', group: 'Transactions', icon: '◷', route: 'amc-scheduling', stretch: 3 },
  { key: 'amcExecution', label: 'AMC Execution', plain: 'Maintenance visits (AMC)', also: ['AMC visits'], group: 'Transactions', icon: '✓', route: 'amc-visits', stretch: 3 },
  { key: 'closure', label: 'Job Closure', plain: 'Job closure', also: ['Job closure'], group: 'Transactions', icon: '⊠', route: 'closure', stretch: 2 },
  { key: 'invoice', label: 'Invoice', plain: 'Invoices', also: ['Invoices'], group: 'Transactions', icon: '▧', route: 'invoices', stretch: 2 },
  { key: 'payment', label: 'Payment Collection', plain: 'Payments', also: ['Payment collection'], group: 'Transactions', icon: '$', route: 'payments', stretch: 2 },

  { key: 'companySetup', label: 'Company Setup', group: 'Admin Setup', icon: '⌂', route: 'admin/companySetup', stretch: 3.5 },
  { key: 'transactionSetup', label: 'Transaction Setup', plain: 'Document settings', group: 'Admin Setup', icon: '#', route: 'admin/transactionSetup', stretch: 3.5 },
  { key: 'userRole', label: 'User Role', group: 'Admin Setup', icon: '☻', route: 'admin/userRole', stretch: 3.5 },
  { key: 'menuAccess', label: 'Menu Access', plain: 'Permissions', group: 'Admin Setup', icon: '⊞', route: 'admin/menuAccess', stretch: 3.5 },
  { key: 'authWorkflow', label: 'Authorization Workflow Master', plain: 'Approval rules', group: 'Admin Setup', icon: '⇶', route: 'admin/authWorkflow', stretch: 3.5 },
];

// UX audit (findings 8 and 9): each menu keeps the name in the team lead's menu file (tl) and may have a
// plain one. `label` gives the one in use (Company Setup → Working style → "Menu names in plain words"); `also` lists
// what pages used to call the same place, so every page shows one name (namesIn() in web/shell.js).
import { ux } from '../core/ux.js';
MENUS.forEach(m => { const tl = m.label; m.tl = tl; Object.defineProperty(m, 'label', { get: () => (m.plain && ux().plainMenus ? m.plain : tl), enumerable: true }); });
export const MASTER_KEYS = MENUS.filter(m => m.group === 'Master').map(m => m.key);
export const menuByKey = key => MENUS.find(m => m.key === key);
export const routeOf = m => m.route || `soon/${m.key}`;

// Phone tabs. Each tab is shown when the role may open its menu on the phone.
export const MOBILE_TABS = [
  { key: 'home', label: 'Home', icon: '⌂', route: 'm/home', needs: null },
  { key: 'jobs', label: 'My jobs', icon: '☰', route: 'm/jobs', needs: ['inspection', 'job', 'amcExecution'], ownOnly: true },
  { key: 'enquiries', label: 'Enquiries', icon: '✎', route: 'm/enquiries', needs: ['enquiry'] },
  { key: 'tasks', label: 'Tasks', icon: '✓', route: 'm/tasks' },
  { key: 'more', label: 'More', icon: '⋯', route: 'm/more', needs: null },
];

// markup / reprice: see / change overhead and markup on estimates (team lead, 17 Nov 2026; Estimation only).
export const ACTIONS = ['view', 'create', 'edit', 'cancel', 'approve', 'print', 'markup', 'reprice'];

// What Menu Access offers per menu (problem 13 of the Part B plan check): only the rights its screens check
// (cancelling is part of Edit), Mobile only where a phone screen exists, Own only where work is assigned to a person.
const MASTER_RIGHTS = ['view', 'create', 'edit'];
export const MENU_RULES = {
  dashboard: { actions: ['view'], phone: true },
  customer: { actions: MASTER_RIGHTS, phone: true }, item: { actions: MASTER_RIGHTS, phone: true },
  employee: { actions: MASTER_RIGHTS }, transport: { actions: MASTER_RIGHTS }, equipment: { actions: MASTER_RIGHTS }, labour: { actions: MASTER_RIGHTS },
  product: { actions: MASTER_RIGHTS }, size: { actions: MASTER_RIGHTS }, uom: { actions: MASTER_RIGHTS }, valueset: { actions: MASTER_RIGHTS }, tax: { actions: MASTER_RIGHTS }, terms: { actions: MASTER_RIGHTS },
  enquiry: { actions: ['view', 'create', 'edit'], phone: true },
  inspection: { actions: ['view', 'edit', 'print'], phone: true, own: true },
  estimation: { actions: ['view', 'create', 'edit', 'markup', 'reprice'] },
  quotation: { actions: ['view', 'edit', 'approve', 'print'], phone: true },
  job: { actions: ['view', 'edit', 'approve'], phone: true, own: true },
  amcContract: { actions: ['view', 'edit'] },
  amcScheduling: { actions: ['view', 'edit'] },
  amcExecution: { actions: ['view', 'edit'], phone: true, own: true },
  closure: { actions: ['view', 'edit'] },
  invoice: { actions: ['view', 'create', 'edit'], phone: true, own: true },
  payment: { actions: ['view', 'create', 'edit'], phone: true, own: true },
  companySetup: { actions: ['view', 'edit'] }, transactionSetup: { actions: ['view', 'edit'] }, userRole: { actions: ['view', 'edit'] },
  menuAccess: { actions: ['view', 'edit'] }, authWorkflow: { actions: ['view', 'edit'] },
};
export const ACTION_LABELS = { view: 'View', create: 'Create', edit: 'Edit', approve: 'Approve', print: 'Print', markup: 'See markup', reprice: 'Change markup' };
// Overhead and markup rights before they existed (data saved earlier): Approver changes them at the counter-check,
// Management sees them. The Admin role always has every right.
export const MARKUP_PRESET = { APR: ['markup', 'reprice'], MGT: ['markup'] };
