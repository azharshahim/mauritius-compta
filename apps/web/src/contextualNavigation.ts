import { NAV_GROUPS, isNavItemActive, type NavGroup, type NavItem } from './navigation';

/**
 * Mission 39 — one route-context resolver for the whole authenticated shell.
 *
 * The sidebar remains the only menu definition. This module adds the missing
 * context (module, parent page, breadcrumb) for routes that are not themselves
 * sidebar entries: detail pages, imports, journal routes and prepared screens.
 * It does not create a second navigation tree and it never grants access: the
 * caller filters the visible groups with the same module permissions.
 */
export interface ContextCrumb {
  labelKey: string;
  /** Current crumb has no link. */
  to?: string;
}

export interface ContextualNavigation {
  groupKey: string;
  groupLabelKey: string;
  groupRoot: string;
  currentLabelKey: string;
  currentPath: string;
  /** Immediate logical parent, used by the breadcrumb. */
  parentPath: string | null;
  parentLabelKey: string | null;
  /** Route to use when there is no safe in-app history. Never the current URL. */
  fallbackPath: string;
  crumbs: ContextCrumb[];
  showBack: boolean;
}

const GROUP_ROOTS: Record<string, string> = {
  home: '/cabinet',
  clients: '/cabinet/companies',
  accounting: '/accounting',
  bank: '/accounting/banking',
  billing: '/billing',
  purchases: '/accounting/purchases',
  assets: '/accounting/assets',
  payroll: '/payroll',
  reports: '/accounting/statements',
  settings: '/accounting/settings',
};

const MODULE_PARENTS: Record<string, string> = {
  home: '/cabinet',
  clients: '/cabinet',
  accounting: '/accounting',
  bank: '/accounting',
  billing: '/billing',
  purchases: '/accounting',
  assets: '/accounting',
  payroll: '/payroll',
  reports: '/accounting',
  settings: '/accounting',
};

const GROUP_KEYS = new Set(NAV_GROUPS.map((group) => group.key));

interface ContextRule {
  pattern: string;
  groupKey: string;
  labelKey: string;
  parent?: string;
  parentLabelKey?: string;
  hideBack?: boolean;
}

/**
 * Most specific patterns first. Every path below already exists in App.tsx.
 * Removed Mission 38 bookmarks are absent on purpose: their redirects land on
 * one of these screens before the contextual bar is rendered.
 */
const RULES: ContextRule[] = [
  {
    pattern: '/cabinet/companies/:companyId/settings',
    groupKey: 'clients',
    labelKey: 'nav.context.companySettings',
    parent: '/cabinet/companies/:companyId',
    parentLabelKey: 'nav.context.companyFile',
  },
  {
    pattern: '/cabinet/companies/:companyId',
    groupKey: 'clients',
    labelKey: 'nav.context.companyFile',
    parent: '/cabinet/companies',
    parentLabelKey: 'nav.cabinet.dossiers',
  },
  {
    pattern: '/accounting/journals/purchases/import/bulk',
    groupKey: 'accounting',
    labelKey: 'nav.context.purchaseBulkImport',
    parent: '/accounting/journals/purchases',
    parentLabelKey: 'nav.journals.purchases',
  },
  {
    pattern: '/accounting/journals/sales/import/bulk',
    groupKey: 'accounting',
    labelKey: 'nav.context.salesBulkImport',
    parent: '/accounting/journals/sales',
    parentLabelKey: 'nav.journals.sales',
  },
  {
    pattern: '/accounting/journals/purchases/import',
    groupKey: 'accounting',
    labelKey: 'nav.context.purchaseImport',
    parent: '/accounting/journals/purchases',
    parentLabelKey: 'nav.journals.purchases',
  },
  {
    pattern: '/accounting/journals/sales/import',
    groupKey: 'accounting',
    labelKey: 'nav.context.salesImport',
    parent: '/accounting/journals/sales',
    parentLabelKey: 'nav.journals.sales',
  },
  {
    pattern: '/accounting/journals/purchases',
    groupKey: 'accounting',
    labelKey: 'nav.journals.purchases',
    parent: '/accounting/entries',
    parentLabelKey: 'nav.entries',
  },
  {
    pattern: '/accounting/journals/sales',
    groupKey: 'accounting',
    labelKey: 'nav.journals.sales',
    parent: '/accounting/entries',
    parentLabelKey: 'nav.entries',
  },
  {
    pattern: '/accounting/journals/bank',
    groupKey: 'accounting',
    labelKey: 'nav.journals.bank',
    parent: '/accounting/entries',
    parentLabelKey: 'nav.entries',
  },
  {
    pattern: '/accounting/journals/general',
    groupKey: 'accounting',
    labelKey: 'nav.journals.general',
    parent: '/accounting/entries',
    parentLabelKey: 'nav.entries',
  },
  {
    pattern: '/accounting/journals',
    groupKey: 'accounting',
    labelKey: 'nav.entries',
    parent: '/accounting',
    parentLabelKey: 'nav.group.accounting',
  },
  {
    pattern: '/accounting/banking/mcb',
    groupKey: 'bank',
    labelKey: 'nav.context.bankMcb',
    parent: '/accounting/banking',
    parentLabelKey: 'nav.bank.accounts',
  },
  {
    pattern: '/accounting/ifrs',
    groupKey: 'accounting',
    labelKey: 'nav.context.prepared',
    parent: '/accounting',
    parentLabelKey: 'nav.group.accounting',
  },
  {
    pattern: '/payroll/payslips/:payslipId',
    groupKey: 'payroll',
    labelKey: 'nav.context.payslip',
    parent: '/payroll/payslips',
    parentLabelKey: 'nav.payroll.payslips',
  },
  { pattern: '/demo', groupKey: 'home', labelKey: 'nav.demo.guided', parent: '/cabinet', hideBack: true },
  {
    pattern: '/cabinet',
    groupKey: 'home',
    labelKey: 'nav.cabinet.dashboard',
    hideBack: true,
  },
  {
    pattern: '/accounting',
    groupKey: 'accounting',
    labelKey: 'nav.context.dashboard',
    hideBack: true,
  },
  {
    pattern: '/billing',
    groupKey: 'billing',
    labelKey: 'nav.context.dashboard',
    hideBack: true,
  },
  {
    pattern: '/payroll',
    groupKey: 'payroll',
    labelKey: 'nav.context.dashboard',
    hideBack: true,
  },
];

interface MatchedRule {
  rule: ContextRule;
  params: Record<string, string>;
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const wanted = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (wanted.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < wanted.length; index += 1) {
    const part = wanted[index]!;
    const value = actual[index]!;
    if (part.startsWith(':')) {
      if (!value) return null;
      params[part.slice(1)] = value;
    } else if (part !== value) {
      return null;
    }
  }
  return params;
}

function fillPattern(pattern: string | undefined, params: Record<string, string>): string | null {
  if (!pattern) return null;
  return pattern
    .split('/')
    .map((part) => (part.startsWith(':') ? params[part.slice(1)] ?? part : part))
    .join('/');
}

function findRule(pathname: string): MatchedRule | null {
  for (const rule of RULES) {
    const params = matchPattern(rule.pattern, pathname);
    if (params) return { rule, params };
  }
  return null;
}

function groupByKey(key: string): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.key === key);
}

function bestActiveItem(pathname: string, search: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!isNavItemActive(item, pathname, search, group.items)) continue;
      if (!best || item.to.length > best.item.to.length) best = { group, item };
    }
  }
  return best;
}

function prefixGroup(pathname: string): NavGroup | undefined {
  const candidates = NAV_GROUPS.flatMap((group) => {
    const root = GROUP_ROOTS[group.key] ?? '';
    const byItem = group.items
      .map((item) => item.to)
      .filter((to) => pathname === to || pathname.startsWith(`${to}/`))
      .sort((a, b) => b.length - a.length)[0];
    const prefix = byItem && byItem.length > root.length ? byItem : root;
    return prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))
      ? [{ group, prefix }]
      : [];
  }).sort((a, b) => b.prefix.length - a.prefix.length);
  return candidates[0]?.group;
}

function crumbsFor(
  group: NavGroup,
  pathname: string,
  currentLabelKey: string,
  parentPath: string | null,
  parentLabelKey: string | null,
): ContextCrumb[] {
  const root = GROUP_ROOTS[group.key] ?? pathname;
  const crumbs: ContextCrumb[] = [];
  // The module crumb stays visible even on the group root: the examples in the
  // brief are "Accounting > Trial Balance" and "Banking > Bank Reconciliation",
  // not a bare page title that loses the module.
  if (group.key !== 'home') crumbs.push({ labelKey: group.labelKey, to: root });
  if (parentPath && parentPath !== root && parentPath !== pathname && parentLabelKey) {
    crumbs.push({ labelKey: parentLabelKey, to: parentPath });
  }
  crumbs.push({ labelKey: currentLabelKey });
  return crumbs;
}

export function resolveContextualNavigation(pathname: string, search = ''): ContextualNavigation {
  const matched = findRule(pathname);
  if (matched) {
    const { rule, params } = matched;
    const group = groupByKey(rule.groupKey) ?? groupByKey('home')!;
    const root = GROUP_ROOTS[group.key] ?? '/cabinet';
    const parentPath = fillPattern(rule.parent, params);
    const fallbackPath =
      parentPath && parentPath !== pathname
        ? parentPath
        : MODULE_PARENTS[group.key] && MODULE_PARENTS[group.key] !== pathname
          ? MODULE_PARENTS[group.key]!
          : root;
    return {
      groupKey: group.key,
      groupLabelKey: group.labelKey,
      groupRoot: root,
      currentLabelKey: rule.labelKey,
      currentPath: pathname,
      parentPath,
      parentLabelKey: rule.parentLabelKey ?? null,
      fallbackPath,
      crumbs: crumbsFor(group, pathname, rule.labelKey, parentPath, rule.parentLabelKey ?? null),
      showBack: rule.hideBack !== true,
    };
  }

  // The fixed-asset report is a tab of a sidebar destination, not a second
  // menu entry. The brief requires the full trail
  // Inventory & Fixed Assets > Fixed Assets > Reports.
  if (pathname === '/accounting/assets') {
    const tab = new URLSearchParams(search).get('tab');
    if (tab === 'depreciation' || tab === 'categories' || tab === 'reports') {
      const group = groupByKey('assets')!;
      const labelKey = `fa.tab.${tab}`;
      return {
        groupKey: group.key,
        groupLabelKey: group.labelKey,
        groupRoot: GROUP_ROOTS.assets!,
        currentLabelKey: labelKey,
        currentPath: pathname,
        parentPath: '/accounting/assets',
        parentLabelKey: 'nav.accounting.assets',
        fallbackPath: '/accounting/assets',
        crumbs: [
          { labelKey: group.labelKey, to: GROUP_ROOTS.assets },
          { labelKey: 'nav.accounting.assets', to: '/accounting/assets' },
          { labelKey },
        ],
        showBack: true,
      };
    }
  }

  const active = bestActiveItem(pathname, search);
  if (active) {
    const { group, item } = active;
    const root = GROUP_ROOTS[group.key] ?? item.to;
    const parentPath = item.to !== pathname ? item.to : null;
    const fallbackPath =
      parentPath && parentPath !== pathname
        ? parentPath
        : root !== pathname
          ? root
          : MODULE_PARENTS[group.key] && MODULE_PARENTS[group.key] !== pathname
            ? MODULE_PARENTS[group.key]!
            : root;
    const parentLabelKey = parentPath
      ? group.items.find((candidate) => candidate.to === parentPath)?.key ?? group.labelKey
      : null;
    return {
      groupKey: group.key,
      groupLabelKey: group.labelKey,
      groupRoot: root,
      currentLabelKey: item.key,
      currentPath: pathname,
      parentPath,
      parentLabelKey,
      fallbackPath,
      crumbs: crumbsFor(group, pathname, item.key, parentPath, parentLabelKey),
      showBack: true,
    };
  }

  const group = prefixGroup(pathname) ?? groupByKey('home')!;
  const root = GROUP_ROOTS[group.key] ?? '/cabinet';
  const fallbackPath =
    MODULE_PARENTS[group.key] && MODULE_PARENTS[group.key] !== pathname
      ? MODULE_PARENTS[group.key]!
      : root !== pathname
        ? root
        : '/cabinet';
  return {
    groupKey: group.key,
    groupLabelKey: group.labelKey,
    groupRoot: root,
    currentLabelKey: 'nav.context.prepared',
    currentPath: pathname,
    parentPath: root !== pathname ? root : null,
    parentLabelKey: null,
    fallbackPath,
    crumbs: crumbsFor(group, pathname, 'nav.context.prepared', root !== pathname ? root : null, null),
    showBack: true,
  };
}

/** Kept exported for tests that want to verify every known group root. */
export function groupRoot(key: string): string | undefined {
  return GROUP_KEYS.has(key) ? GROUP_ROOTS[key] : undefined;
}
