// Menu catalogue, following the team lead's "Application Menu Structure" sheet.
// stretch: the build stretch that delivers the screen; menus above BUILT_STRETCH show a "coming" page.
export const GROUPS = ['Dashboard', 'Master', 'Transactions', 'Admin Setup'];
export const BUILT_STRETCH = 2;

export const MENUS = [
  { key: 'dashboard', label: 'Dashboard', group: 'Dashboard', icon: '◧', route: 'home', stretch: 1 },

  { key: 'customer', label: 'Customer', group: 'Master', icon: '☷', route: 'master/customer', stretch: 1 },
  { key: 'employee', label: 'Employee / Technician', group: 'Master', icon: '☺', route: 'master/employee', stretch: 1 },
  { key: 'transport', label: 'Transport', group: 'Master', icon: '⛟', route: 'master/transport', stretch: 1 },
  { key: 'equipment', label: 'Equipment', group: 'Master', icon: '⚙', route: 'master/equipment', stretch: 1 },
  { key: 'labour', label: 'Labour', group: 'Master', icon: '⚒', route: 'master/labour', stretch: 1 },
  { key: 'product', label: 'Product', group: 'Master', icon: '▥', route: 'master/product', stretch: 1 },
  { key: 'item', label: 'Material/Item', group: 'Master', icon: '▣', route: 'master/item', stretch: 1 },
  { key: 'size', label: 'Shutter Size', group: 'Master', icon: '⬚', route: 'master/size', stretch: 1 },
  { key: 'valueset', label: 'Value Set Master', group: 'Master', icon: '≡', route: 'master/valueset', stretch: 1 },
  { key: 'tax', label: 'Tax', group: 'Master', icon: '%', route: 'master/tax', stretch: 1 },
  { key: 'terms', label: 'Terms', group: 'Master', icon: '¶', route: 'master/terms', stretch: 1 },

  { key: 'enquiry', label: 'Sales Enquiry', group: 'Transactions', icon: '✎', route: 'enquiries', stretch: 1 },
  { key: 'inspection', label: 'Site Inspection', group: 'Transactions', icon: '⌖', route: 'inspections', stretch: 1 },
  { key: 'estimation', label: 'Estimation', group: 'Transactions', icon: '∑', route: 'estimates', stretch: 2 },
  { key: 'quotation', label: 'Sales Quotation', group: 'Transactions', icon: '▤', route: 'quotations', stretch: 2 },
  { key: 'job', label: 'Job Execution', group: 'Transactions', icon: '⚑', route: 'jobs', stretch: 2 },
  { key: 'amcContract', label: 'AMC Contract', group: 'Transactions', icon: '▦', stretch: 3 },
  { key: 'amcScheduling', label: 'AMC Scheduling', group: 'Transactions', icon: '◷', stretch: 3 },
  { key: 'amcExecution', label: 'AMC Execution', group: 'Transactions', icon: '✓', stretch: 3 },
  { key: 'closure', label: 'Job Closure', group: 'Transactions', icon: '⊠', route: 'closure', stretch: 2 },
  { key: 'invoice', label: 'Invoice', group: 'Transactions', icon: '▧', route: 'invoices', stretch: 2 },
  { key: 'payment', label: 'Payment Collection', group: 'Transactions', icon: '$', route: 'payments', stretch: 2 },

  { key: 'companySetup', label: 'Company Setup', group: 'Admin Setup', icon: '⌂', route: 'admin/companySetup', stretch: 3, preview: true },
  { key: 'transactionSetup', label: 'Transaction Setup', group: 'Admin Setup', icon: '#', route: 'admin/transactionSetup', stretch: 3, preview: true },
  { key: 'userRole', label: 'User Role', group: 'Admin Setup', icon: '☻', route: 'admin/userRole', stretch: 3, preview: true },
  { key: 'menuAccess', label: 'Menu Access', group: 'Admin Setup', icon: '⊞', route: 'admin/menuAccess', stretch: 3, preview: true },
  { key: 'authWorkflow', label: 'Authorization Workflow Master', group: 'Admin Setup', icon: '⇶', stretch: 3 },
];

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

export const ACTIONS = ['view', 'create', 'edit', 'cancel', 'approve', 'print'];
