/**
 * Browser-only demonstration backend.
 *
 * When the bundle is built with VITE_DEMO_MODE=true (GitHub Pages demo), every
 * `/api/*` call is served by this module instead of the Fastify server:
 *
 *   - data lives in localStorage (fictional dataset from the API's own demo seed);
 *   - no network request, no PostgreSQL, no secret, no real customer data;
 *   - the accounting rules of the real engine are reproduced here (exact decimal
 *     arithmetic, numbering, balance control, posted-entry immutability, reversal,
 *     period checks, unique references, trial balance and statements).
 *
 * The interface stays identical: only the transport changes, and a permanent
 * banner states that operations are simulated and never stored on a server.
 */
import { ApiError } from '../errors';
import { toScaled4, scaled4ToString } from '../format';
import { DEMO_SEED } from './seed-data';

/* ------------------------------------------------------------------ types */

export interface DemoUser {
  id: string;
  email: string;
  password: string;
  full_name: string;
  locale: 'fr' | 'en';
}

export interface DemoCompany {
  id: string;
  name: string;
  brn: string | null;
  crn: string | null;
  client_code: string | null;
  dossier_manager_id: string | null;
  archived_at: string | null;
  vat_number: string | null;
  registered_address: string | null;
  business_activity: string | null;
  financial_year_start: string;
  financial_year_end: string;
  functional_currency: string;
  presentation_currency: string;
  accounting_standard: string;
  status: 'active' | 'inactive' | 'archived';
  locale: 'fr' | 'en';
  created_at: string;
}

export interface DemoAccount {
  id: string;
  company_id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id: string | null;
  currency: string;
  is_active: boolean;
  fs_mapping: string | null;
  description: string | null;
}

export interface DemoJournal {
  id: string;
  company_id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
}

export interface DemoEntry {
  id: string;
  company_id: string;
  journal_id: string;
  entry_no: string;
  entry_date: string;
  reference: string | null;
  description: string;
  currency: string;
  exchange_rate: string;
  status: 'draft' | 'posted';
  source: 'manual' | 'reversal';
  reversal_of_entry_id: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface DemoLine {
  id: string;
  entry_id: string;
  company_id: string;
  account_id: string;
  line_no: number;
  description: string | null;
  debit: string;
  credit: string;
  txn_amount: string | null;
  txn_currency: string;
  fx_rate: string | null;
}

export interface DemoPeriod {
  id: string;
  company_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
}

export interface DemoRate {
  id: string;
  company_id: string;
  from_currency: string;
  to_currency: string;
  rate_date: string;
  rate: string;
  source: string;
}

export interface DemoMember {
  id: string;
  company_id: string;
  user_id: string;
  role: string;
  email: string;
  full_name: string;
}

export interface DemoModuleAccess {
  company_id: string;
  user_id: string;
  module: 'cabinet' | 'accounting' | 'billing' | 'payroll';
  access: 'read' | 'write' | 'admin';
}

export interface DemoTask {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoTaskComment {
  id: string;
  task_id: string;
  company_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface DemoAuditEvent {
  id: number;
  company_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DemoState {
  schema: number;
  users: DemoUser[];
  session: string | null;
  companies: DemoCompany[];
  accounts: DemoAccount[];
  journals: DemoJournal[];
  entries: DemoEntry[];
  lines: DemoLine[];
  periods: DemoPeriod[];
  rates: DemoRate[];
  members: DemoMember[];
  moduleAccess: DemoModuleAccess[];
  tasks: DemoTask[];
  taskComments: DemoTaskComment[];
  audit: DemoAuditEvent[];
  sequences: Record<string, number>;
  auditSeq: number;
}

/* ------------------------------------------------------------------ money */

const RATE_SCALE = 8n;
const RATE_FACTOR = 10n ** RATE_SCALE;

function parseRate(raw: string | number): bigint {
  const text = String(raw).trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new ApiError(400, 'VALIDATION_ERROR', 'Taux invalide');
  const int = BigInt(match[1]!);
  const frac = (match[2] ?? '').slice(0, 8).padEnd(8, '0');
  const scaled = int * RATE_FACTOR + BigInt(frac);
  if (scaled <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Taux invalide');
  return scaled;
}

function rateToString(scaled: bigint): string {
  const int = scaled / RATE_FACTOR;
  const frac = (scaled % RATE_FACTOR).toString().padStart(8, '0');
  return `${int}.${frac}`;
}

/** Keeps 8 significant decimals of an already computed string (no float). */
function normaliseRate(scaled: bigint): string {
  return rateToString(scaled);
}

const amount = (value: string | number | null | undefined): bigint => toScaled4(value) ?? 0n;

/** Exact multiplication of an amount (scale 4) by a rate (scale 8). */
function multiply(amountScaled: bigint, rateScaled: bigint): bigint {
  const product = amountScaled * rateScaled; // scale 12
  const unit = 10n ** RATE_SCALE; // 1e8
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const quotient = abs / unit;
  const remainder = abs % unit;
  const rounded = remainder * 2n >= unit ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

const fmt = (scaled: bigint): string => scaled4ToString(scaled);

function reciprocal(rateScaled: bigint): string {
  const numerator = RATE_FACTOR * RATE_FACTOR; // 1e16
  const quotient = numerator / rateScaled;
  const remainder = numerator % rateScaled;
  const rounded = remainder * 2n >= rateScaled ? quotient + 1n : quotient;
  return normaliseRate(rounded);
}

/* --------------------------------------------------------------- storage */

const STORAGE_KEY = 'mc.demo.state.v1';
export const DEMO_EMAIL = 'demo@mauritius-compta.test';
export const DEMO_PASSWORD = 'DemoPassw0rd2026';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);

function memoryStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__mc_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null; // private mode / disabled storage: demo still works in memory
  }
}

let state: DemoState | null = null;
let volatile = false;

function seedState(): DemoState {
  const created = now();
  const demoUser: DemoUser = {
    id: uid(),
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    full_name: 'Comptable de démonstration',
    locale: 'fr',
  };
  const company: DemoCompany = {
    id: uid(),
    name: DEMO_SEED.company.name ?? 'Lagon Bleu Trading Ltd (DEMO)',
    brn: DEMO_SEED.company.brn ?? null,
    crn: 'CRN-DEMO-0001',
    client_code: 'DEMO-001',
    dossier_manager_id: demoUser.id,
    archived_at: null,
    vat_number: DEMO_SEED.company.vat_number ?? null,
    registered_address: DEMO_SEED.company.registered_address ?? null,
    business_activity: DEMO_SEED.company.business_activity ?? null,
    financial_year_start: DEMO_SEED.company.financial_year_start ?? '2025-07-01',
    financial_year_end: DEMO_SEED.company.financial_year_end ?? '2026-06-30',
    functional_currency: DEMO_SEED.company.functional_currency ?? 'MUR',
    presentation_currency: DEMO_SEED.company.presentation_currency ?? 'MUR',
    accounting_standard: DEMO_SEED.company.accounting_standard ?? 'IFRS',
    status: (DEMO_SEED.company.status as DemoCompany['status']) ?? 'active',
    locale: (DEMO_SEED.company.locale as 'fr' | 'en') ?? 'fr',
    created_at: created,
  };

  const accounts: DemoAccount[] = [];
  const accountByCode = new Map<string, DemoAccount>();
  for (const a of DEMO_SEED.accounts) {
    const account: DemoAccount = {
      id: uid(),
      company_id: company.id,
      code: a.code,
      name: a.name,
      type: a.type as DemoAccount['type'],
      parent_id: null,
      currency: a.currency,
      is_active: a.is_active,
      fs_mapping: a.fs_mapping,
      description: a.description,
    };
    accounts.push(account);
    accountByCode.set(a.code, account);
  }
  for (const a of DEMO_SEED.accounts) {
    if (a.parent_code) {
      const child = accountByCode.get(a.code);
      const parent = accountByCode.get(a.parent_code);
      if (child && parent) child.parent_id = parent.id;
    }
  }

  const journals: DemoJournal[] = DEMO_SEED.journals.map((j) => ({
    id: uid(),
    company_id: company.id,
    code: j.code,
    name: j.name,
    type: j.type,
    is_active: true,
  }));
  const journalByCode = new Map(journals.map((j) => [j.code, j]));

  const entries: DemoEntry[] = [];
  const lines: DemoLine[] = [];
  const byNumber = new Map<string, DemoEntry>();

  for (const e of DEMO_SEED.entries) {
    const journal = journalByCode.get(e.journal_code);
    if (!journal) continue;
    const entry: DemoEntry = {
      id: uid(),
      company_id: company.id,
      journal_id: journal.id,
      entry_no: e.entry_no,
      entry_date: e.entry_date,
      reference: e.reference,
      description: e.description,
      currency: e.currency,
      exchange_rate: e.exchange_rate,
      status: e.status,
      source: (e.source as DemoEntry['source']) ?? 'manual',
      reversal_of_entry_id: null,
      posted_at: e.status === 'posted' ? `${e.entry_date}T09:00:00.000Z` : null,
      created_at: `${e.entry_date}T09:00:00.000Z`,
    };
    entries.push(entry);
    byNumber.set(entry.entry_no, entry);
    e.lines.forEach((l, index) => {
      const account = accountByCode.get(l.account_code);
      if (!account) return;
      lines.push({
        id: uid(),
        entry_id: entry.id,
        company_id: company.id,
        account_id: account.id,
        line_no: index + 1,
        description: l.description,
        debit: l.debit ?? '0.0000',
        credit: l.credit ?? '0.0000',
        txn_amount: l.txn_amount,
        txn_currency: l.txn_currency,
        fx_rate: l.fx_rate,
      });
    });
  }
  for (const e of DEMO_SEED.entries) {
    if (e.reversal_of) {
      const child = byNumber.get(e.entry_no);
      const parent = byNumber.get(e.reversal_of);
      if (child && parent) child.reversal_of_entry_id = parent.id;
    }
  }

  const sequences: Record<string, number> = {};
  for (const entry of entries) {
    const year = entry.entry_date.slice(0, 4);
    const journal = journals.find((j) => j.id === entry.journal_id);
    if (!journal) continue;
    const key = `${journal.code}-${year}`;
    const n = Number(entry.entry_no.split('-')[2] ?? '0');
    sequences[key] = Math.max(sequences[key] ?? 0, n);
  }

  const periods: DemoPeriod[] = [
    {
      id: uid(),
      company_id: company.id,
      name: 'FY 2025/2026',
      start_date: company.financial_year_start,
      end_date: company.financial_year_end,
      status: 'open',
    },
  ];

  const rates: DemoRate[] = [
    {
      id: uid(),
      company_id: company.id,
      from_currency: 'EUR',
      to_currency: company.functional_currency,
      rate_date: '2025-08-12',
      rate: '48.50000000',
      source: 'Taux de démonstration (fictif)',
    },
  ];

  const members: DemoMember[] = [
    {
      id: uid(),
      company_id: company.id,
      user_id: demoUser.id,
      role: 'owner',
      email: demoUser.email,
      full_name: demoUser.full_name,
    },
  ];

  // ------------------------------------------------- collaborators (fictifs)
  const collaborators: DemoUser[] = [
    {
      id: uid(),
      email: 'a.ramgoolam@cabinet-demo.test',
      password: 'DemoCollab2026',
      full_name: 'Anjali Ramgoolam (fictif)',
      locale: 'fr',
    },
    {
      id: uid(),
      email: 'j.leclézio@cabinet-demo.test',
      password: 'DemoCollab2026',
      full_name: 'Jean Leclézio (fictif)',
      locale: 'fr',
    },
    {
      id: uid(),
      email: 's.patel@cabinet-demo.test',
      password: 'DemoCollab2026',
      full_name: 'Sonia Patel (fictive)',
      locale: 'en',
    },
  ];

  // --------------------------------------------- additional demo dossiers
  const extraSeed = [
    {
      name: 'Case Noyale Retail Ltd (DEMO)',
      brn: 'DEMO-BRN-0002',
      vat: 'DEMO-VAT-0002',
      crn: 'CRN-DEMO-0002',
      code: 'DEMO-002',
      activity: 'Commerce de détail (fictif)',
      address: '12, Royal Road, Case Noyale (fictif)',
      manager: collaborators[0]!.id,
      status: 'active' as const,
    },
    {
      name: 'Belle Mare Hospitality Ltd (DEMO)',
      brn: 'DEMO-BRN-0003',
      vat: 'DEMO-VAT-0003',
      crn: 'CRN-DEMO-0003',
      code: 'DEMO-003',
      activity: 'Hôtellerie et restauration (fictif)',
      address: '3, Coastal Road, Belle Mare (fictif)',
      manager: collaborators[1]!.id,
      status: 'active' as const,
    },
    {
      name: 'Vieux Grand Port Logistics Ltd (DEMO)',
      brn: 'DEMO-BRN-0004',
      vat: null,
      crn: 'CRN-DEMO-0004',
      code: 'DEMO-004',
      activity: 'Transit et logistique (fictif)',
      address: '8, Harbour Street, Vieux Grand Port (fictif)',
      manager: null as string | null,
      status: 'archived' as const,
    },
  ];

  const minimalChart: [string, string, DemoAccount['type']][] = [
    ['1010', 'Banque (MUR)', 'asset'],
    ['2010', 'Fournisseurs', 'liability'],
    ['3010', 'Capital social', 'equity'],
    ['4000', 'Ventes', 'revenue'],
    ['5000', 'Achats', 'expense'],
    ['6010', 'Charges externes', 'expense'],
  ];

  const extraCompanies: DemoCompany[] = [];
  const extraMembers: DemoMember[] = [];
  for (const seed of extraSeed) {
    const extra: DemoCompany = {
      id: uid(),
      name: seed.name,
      brn: seed.brn,
      crn: seed.crn,
      client_code: seed.code,
      dossier_manager_id: seed.manager,
      archived_at: seed.status === 'archived' ? created : null,
      vat_number: seed.vat,
      registered_address: seed.address,
      business_activity: seed.activity,
      financial_year_start: '2025-07-01',
      financial_year_end: '2026-06-30',
      functional_currency: 'MUR',
      presentation_currency: 'MUR',
      accounting_standard: 'IFRS for SMEs',
      status: seed.status,
      locale: 'fr',
      created_at: created,
    };
    extraCompanies.push(extra);
    for (const [code, name, type] of minimalChart) {
      accounts.push({
        id: uid(),
        company_id: extra.id,
        code,
        name,
        type,
        parent_id: null,
        currency: 'MUR',
        is_active: true,
        fs_mapping: code.startsWith('1') ? 'bs.current_assets.cash_and_equivalents' : null,
        description: null,
      });
    }
    for (const template of DEMO_SEED.journals.filter((j) =>
      ['OD', 'VE', 'AC'].includes(j.code),
    )) {
      journals.push({
        id: uid(),
        company_id: extra.id,
        code: template.code,
        name: template.name,
        type: template.type,
        is_active: true,
      });
    }
    periods.push({
      id: uid(),
      company_id: extra.id,
      name: 'FY 2025/2026',
      start_date: extra.financial_year_start,
      end_date: extra.financial_year_end,
      status: 'open',
    });
    extraMembers.push({
      id: uid(),
      company_id: extra.id,
      user_id: demoUser.id,
      role: 'cabinet_admin',
      email: demoUser.email,
      full_name: demoUser.full_name,
    });
    if (seed.manager) {
      const manager = collaborators.find((c) => c.id === seed.manager)!;
      extraMembers.push({
        id: uid(),
        company_id: extra.id,
        user_id: manager.id,
        role: 'manager',
        email: manager.email,
        full_name: manager.full_name,
      });
    }
  }

  // ------------------------------------------------------ cabinet tasks
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const taskSeed: {
    company: string;
    title: string;
    category: string;
    priority: string;
    status: string;
    due: number;
    assignee: string | null;
    description?: string;
  }[] = [
    {
      company: company.id,
      title: 'Réviser la balance au 30 septembre (fictif)',
      category: 'accounting',
      priority: 'high',
      status: 'in_progress',
      due: 3,
      assignee: demoUser.id,
      description: 'Contrôle des comptes d’attente et des comptes bancaires.',
    },
    {
      company: company.id,
      title: 'Préparer le dossier TVA du trimestre (fictif)',
      category: 'vat',
      priority: 'urgent',
      status: 'todo',
      due: -2,
      assignee: collaborators[2]!.id,
    },
    {
      company: company.id,
      title: 'Mettre à jour les états financiers provisoires',
      category: 'financial_statements',
      priority: 'normal',
      status: 'todo',
      due: 12,
      assignee: collaborators[0]!.id,
    },
    {
      company: company.id,
      title: 'Classer les justificatifs fournisseurs',
      category: 'administrative',
      priority: 'low',
      status: 'done',
      due: -12,
      assignee: demoUser.id,
    },
    {
      company: extraCompanies[0]!.id,
      title: 'Rapprochement bancaire de septembre (fictif)',
      category: 'accounting',
      priority: 'high',
      status: 'todo',
      due: 5,
      assignee: collaborators[0]!.id,
    },
    {
      company: extraCompanies[0]!.id,
      title: 'Inventaire de fin d’année',
      category: 'accounting',
      priority: 'normal',
      status: 'blocked',
      due: 21,
      assignee: collaborators[1]!.id,
    },
    {
      company: extraCompanies[1]!.id,
      title: 'Contrôle des notes de restaurant (fictif)',
      category: 'vat',
      priority: 'normal',
      status: 'todo',
      due: -5,
      assignee: collaborators[1]!.id,
    },
    {
      company: extraCompanies[1]!.id,
      title: 'Préparer la revue de paie du mois',
      category: 'payroll',
      priority: 'normal',
      status: 'todo',
      due: 9,
      assignee: null,
    },
    {
      company: extraCompanies[2]!.id,
      title: 'Archiver les liasses 2024 (fictif)',
      category: 'administrative',
      priority: 'low',
      status: 'done',
      due: -30,
      assignee: demoUser.id,
    },
  ];
  const tasks: DemoTask[] = taskSeed.map((task) => ({
    id: uid(),
    company_id: task.company,
    title: task.title,
    description: task.description ?? null,
    category: task.category,
    priority: task.priority,
    status: task.status,
    due_date: day(task.due),
    assigned_to: task.assignee,
    created_by: demoUser.id,
    completed_at: task.status === 'done' ? now() : null,
    created_at: created,
    updated_at: created,
  }));

  const taskComments: DemoTaskComment[] = tasks.slice(0, 2).map((task, i) => ({
    id: uid(),
    task_id: task.id,
    company_id: task.company_id,
    author_id: collaborators[i]!.id,
    body:
      i === 0
        ? 'Premier contrôle effectué, deux comptes restent à justifier (fictif).'
        : 'Pièces reçues du client, vérification en cours (fictif).',
    created_at: now(),
  }));

  return {
    schema: 2,
    users: [demoUser, ...collaborators],
    session: null,
    companies: [company, ...extraCompanies],
    accounts,
    journals,
    entries,
    lines,
    periods,
    rates,
    members: [...members, ...extraMembers],
    moduleAccess: [],
    tasks,
    taskComments,
    audit: [
      {
        id: 1,
        company_id: company.id,
        user_id: demoUser.id,
        user_email: demoUser.email,
        action: 'demo.seed',
        entity_type: 'company',
        entity_id: company.id,
        details: { note: 'Données fictives chargées dans le navigateur' },
        created_at: now(),
      },
    ],
    sequences,
    auditSeq: 1,
  };
}

function persist(): void {
  if (volatile || !state) return;
  const storage = memoryStorage();
  if (!storage) {
    volatile = true;
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    volatile = true; // quota exceeded: keep working in memory
  }
}

export function loadState(): DemoState {
  if (state) return state;
  const storage = memoryStorage();
  if (storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DemoState;
        if (parsed && parsed.schema === 2) {
          state = parsed;
          return state;
        }
      } catch {
        /* corrupted payload: reseed below */
      }
    }
  }
  state = seedState();
  persist();
  return state;
}

export function resetDemo(): void {
  state = seedState();
  volatile = false;
  persist();
}

export const isDemoVolatile = () => volatile;

/* ---------------------------------------------------------------- engine */

function audit(
  companyId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): void {
  const s = loadState();
  const user = currentUser();
  s.auditSeq += 1;
  s.audit.push({
    id: s.auditSeq,
    company_id: companyId,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    created_at: now(),
  });
}

export function currentUser(): DemoUser | null {
  const s = loadState();
  if (!s.session) return null;
  return s.users.find((u) => u.id === s.session) ?? null;
}

function publicUser(user: DemoUser) {
  return { id: user.id, email: user.email, fullName: user.full_name, locale: user.locale };
}

function requireUser(): DemoUser {
  const user = currentUser();
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentification requise');
  return user;
}

function requireCompany(companyId: string): {
  company: DemoCompany;
  role: DemoMember['role'];
  user: DemoUser;
} {
  const s = loadState();
  const user = requireUser();
  const company = s.companies.find((c) => c.id === companyId);
  const member = s.members.find((m) => m.company_id === companyId && m.user_id === user.id);
  if (!company || !member) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  return { company, role: member.role, user };
}

function accountsOf(companyId: string): DemoAccount[] {
  return loadState().accounts.filter((a) => a.company_id === companyId);
}

function journalTotals(entryId: string) {
  const s = loadState();
  const lines = s.lines.filter((l) => l.entry_id === entryId);
  const debit = lines.reduce((acc, l) => acc + amount(l.debit), 0n);
  const credit = lines.reduce((acc, l) => acc + amount(l.credit), 0n);
  return { debit, credit, lines };
}

function nextEntryNo(companyId: string, journalCode: string, entryDate: string): string {
  const s = loadState();
  const year = entryDate.slice(0, 4);
  const key = `${journalCode}-${year}`;
  const next = (s.sequences[key] ?? 0) + 1;
  s.sequences[key] = next;
  const company = s.companies.find((c) => c.id === companyId);
  const prefix = company ? `${journalCode}-${year}-` : '';
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function assertReferenceFree(companyId: string, reference: string | null | undefined, excludeId?: string) {
  const value = reference?.trim();
  if (!value) return;
  const s = loadState();
  const clash = s.entries.some(
    (e) =>
      e.company_id === companyId &&
      e.source === 'manual' &&
      e.id !== excludeId &&
      (e.reference ?? '').trim().toLowerCase() === value.toLowerCase(),
  );
  if (clash) throw new ApiError(409, 'REFERENCE_TAKEN', `Référence « ${value} » déjà utilisée`);
}

const SUPPORTED_CURRENCIES = ['MUR', 'EUR', 'USD', 'GBP'];

interface PreparedLine {
  accountId: string;
  description: string | null;
  debit: string;
  credit: string;
  txnAmount: string;
  txnCurrency: string;
  fxRate: string;
}

function prepareLines(
  company: DemoCompany,
  payload: { currency?: string; exchangeRate?: string | number | null; lines: any[] },
): { currency: string; fxRate: string; lines: PreparedLine[]; balanced: boolean } {
  const currency = (payload.currency ?? company.functional_currency).toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new ApiError(400, 'INVALID_CURRENCY', `Devise non supportée : ${currency}`);
  }
  const foreign = currency !== company.functional_currency;
  let rateScaled = RATE_FACTOR; // 1.00000000
  if (foreign) {
    if (payload.exchangeRate === undefined || payload.exchangeRate === null || payload.exchangeRate === '') {
      throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', `Un taux est requis pour ${currency}`);
    }
    rateScaled = parseRate(payload.exchangeRate);
  }

  const accounts = accountsOf(company.id);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const prepared: PreparedLine[] = [];
  let totalDebit = 0n;
  let totalCredit = 0n;

  payload.lines.forEach((line, index) => {
    const account = byId.get(String(line.accountId));
    if (!account) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Compte inconnu (ligne ${index + 1})`);
    }
    if (!account.is_active) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Compte inactif : ${account.code}`);
    }
    const hasDebit = line.debit !== undefined && line.debit !== null && String(line.debit).trim() !== '';
    const hasCredit =
      line.credit !== undefined && line.credit !== null && String(line.credit).trim() !== '';
    if (hasDebit === hasCredit) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `Ligne ${index + 1} : indiquez un débit ou un crédit, pas les deux`,
      );
    }
    const raw = hasDebit ? line.debit : line.credit;
    if (decimalPlaces(raw) > 4) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Montants limités à 4 décimales');
    }
    const scaled = amount(raw);
    if (scaled <= 0n) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Ligne ${index + 1} : montant invalide`);
    }
    const functional = multiply(scaled, rateScaled);
    if (functional === 0n) {
      throw new ApiError(400, 'AMOUNT_TOO_SMALL', 'Montant nul après conversion');
    }
    const debit = hasDebit ? fmt(functional) : '0.0000';
    const credit = hasDebit ? '0.0000' : fmt(functional);
    if (hasDebit) totalDebit += functional;
    else totalCredit += functional;
    prepared.push({
      accountId: account.id,
      description: line.description ?? null,
      debit,
      credit,
      txnAmount: fmt(scaled),
      txnCurrency: currency,
      fxRate: rateToString(rateScaled),
    });
  });

  return {
    currency,
    fxRate: rateToString(rateScaled),
    lines: prepared,
    balanced: totalDebit === totalCredit && totalDebit > 0n,
  };
}

function decimalPlaces(value: unknown): number {
  const text = String(value ?? '').trim().replace(',', '.');
  const decimals = text.split('.')[1];
  return decimals ? decimals.length : 0;
}

function assertOpenPeriod(companyId: string, date: string): void {
  const s = loadState();
  const period = s.periods.find(
    (p) => p.company_id === companyId && p.status === 'open' && p.start_date <= date && p.end_date >= date,
  );
  if (!period) {
    throw new ApiError(409, 'PERIOD_CLOSED', `Aucune période ouverte ne couvre le ${date}`);
  }
}

function entryTotals(entry: DemoEntry): string {
  const { debit } = journalTotals(entry.id);
  return fmt(debit);
}

function listEntries(companyId: string, query: URLSearchParams) {
  const s = loadState();
  const status = query.get('status') ?? '';
  const journalId = query.get('journalId') ?? '';
  const search = (query.get('search') ?? '').toLowerCase();
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const limit = Number(query.get('limit') ?? 50);
  const offset = Number(query.get('offset') ?? 0);

  const journals = new Map(s.journals.map((j) => [j.id, j]));
  const filtered = s.entries
    .filter((e) => e.company_id === companyId)
    .filter((e) => (status ? e.status === status : true))
    .filter((e) => (journalId ? e.journal_id === journalId : true))
    .filter((e) => (from ? e.entry_date >= from : true))
    .filter((e) => (to ? e.entry_date <= to : true))
    .filter((e) =>
      search
        ? `${e.entry_no} ${e.description} ${e.reference ?? ''}`.toLowerCase().includes(search)
        : true,
    )
    .sort((a, b) => (a.entry_date === b.entry_date ? b.entry_no.localeCompare(a.entry_no) : b.entry_date.localeCompare(a.entry_date)));

  const page = filtered.slice(offset, offset + limit).map((e) => {
    const journal = journals.get(e.journal_id);
    return {
      id: e.id,
      entry_no: e.entry_no,
      entry_date: e.entry_date,
      reference: e.reference,
      description: e.description,
      status: e.status,
      currency: e.currency,
      journal_code: journal?.code ?? '',
      journal_name: journal?.name ?? '',
      total_debit: entryTotals(e),
      reversal_entry_id:
        s.entries.find((r) => r.reversal_of_entry_id === e.id && r.company_id === companyId)?.id ?? null,
    };
  });

  return { entries: page, total: filtered.length };
}

function entryDetail(companyId: string, entryId: string) {
  const s = loadState();
  const entry = s.entries.find((e) => e.id === entryId && e.company_id === companyId);
  if (!entry) throw new ApiError(404, 'ENTRY_NOT_FOUND', 'Écriture introuvable');
  const journal = s.journals.find((j) => j.id === entry.journal_id);
  const accounts = new Map(accountsOf(companyId).map((a) => [a.id, a]));
  const reversed = entry.reversal_of_entry_id
    ? s.entries.find((e) => e.id === entry.reversal_of_entry_id)
    : null;
  const reversal = s.entries.find(
    (e) => e.reversal_of_entry_id === entry.id && e.company_id === companyId,
  );
  const lines = s.lines
    .filter((l) => l.entry_id === entry.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => {
      const account = accounts.get(l.account_id);
      return {
        id: l.id,
        account_id: l.account_id,
        account_code: account?.code ?? '',
        account_name: account?.name ?? '',
        description: l.description,
        debit: l.debit,
        credit: l.credit,
        txn_amount: l.txn_amount,
        txn_currency: l.txn_currency,
        fx_rate: l.fx_rate,
      };
    });

  return {
    entry: {
      id: entry.id,
      entry_no: entry.entry_no,
      entry_date: entry.entry_date,
      reference: entry.reference,
      description: entry.description,
      status: entry.status,
      currency: entry.currency,
      exchange_rate: entry.exchange_rate,
      source: entry.source,
      posted_at: entry.posted_at,
      journal_code: journal?.code ?? '',
      journal_name: journal?.name ?? '',
      journal_type: journal?.type ?? '',
      reversal_of_entry_id: entry.reversal_of_entry_id,
      reversed_entry_no: reversed?.entry_no ?? null,
      reversal_entry_id: reversal?.id ?? null,
      reversal_entry_no: reversal?.entry_no ?? null,
      total_debit: entryTotals(entry),
    },
    lines,
    attachments: [] as { id: string; original_name: string; mime_type: string; size_bytes: number }[],
  };
}

/* --------------------------------------------------------------- reports */

function postedLines(companyId: string, from: string, to: string) {
  const s = loadState();
  const accountById = new Map(accountsOf(companyId).map((a) => [a.id, a]));
  const entries = new Map(
    s.entries.filter((e) => e.company_id === companyId && e.status === 'posted').map((e) => [e.id, e]),
  );
  return s.lines
    .filter((l) => l.company_id === companyId)
    .map((l) => ({ line: l, entry: entries.get(l.entry_id), account: accountById.get(l.account_id) }))
    .filter((x) => x.entry && x.account && x.entry.entry_date <= to)
    .map((x) => ({
      ...x,
      inRange: x.entry!.entry_date >= from,
      before: x.entry!.entry_date < from,
    }));
}

function computeTrialBalance(companyId: string, currency: string, from: string, to: string) {
  const rows = new Map<
    string,
    {
      account: DemoAccount;
      openingDebit: bigint;
      openingCredit: bigint;
      movementDebit: bigint;
      movementCredit: bigint;
    }
  >();

  for (const item of postedLines(companyId, from, to)) {
    const key = item.account!.id;
    const row =
      rows.get(key) ??
      {
        account: item.account!,
        openingDebit: 0n,
        openingCredit: 0n,
        movementDebit: 0n,
        movementCredit: 0n,
      };
    const debit = amount(item.line.debit);
    const credit = amount(item.line.credit);
    if (item.before) {
      row.openingDebit += debit;
      row.openingCredit += credit;
    } else {
      row.movementDebit += debit;
      row.movementCredit += credit;
    }
    rows.set(key, row);
  }

  const out: any[] = [];
  const totals = {
    openingDebit: 0n,
    openingCredit: 0n,
    movementDebit: 0n,
    movementCredit: 0n,
    closingDebit: 0n,
    closingCredit: 0n,
  };

  for (const row of [...rows.values()].sort((a, b) => a.account.code.localeCompare(b.account.code))) {
    const openNet = row.openingDebit - row.openingCredit;
    const closingNet = openNet + row.movementDebit - row.movementCredit;
    const openingDebit = openNet > 0n ? openNet : 0n;
    const openingCredit = openNet < 0n ? -openNet : 0n;
    const closingDebit = closingNet > 0n ? closingNet : 0n;
    const closingCredit = closingNet < 0n ? -closingNet : 0n;
    if (openNet === 0n && row.movementDebit === 0n && row.movementCredit === 0n && closingNet === 0n) {
      continue;
    }
    out.push({
      accountId: row.account.id,
      code: row.account.code,
      name: row.account.name,
      type: row.account.type,
      openingDebit: fmt(openingDebit),
      openingCredit: fmt(openingCredit),
      movementDebit: fmt(row.movementDebit),
      movementCredit: fmt(row.movementCredit),
      closingDebit: fmt(closingDebit),
      closingCredit: fmt(closingCredit),
    });
    totals.openingDebit += openingDebit;
    totals.openingCredit += openingCredit;
    totals.movementDebit += row.movementDebit;
    totals.movementCredit += row.movementCredit;
    totals.closingDebit += closingDebit;
    totals.closingCredit += closingCredit;
  }

  return {
    from,
    to,
    currency,
    balanced: totals.movementDebit === totals.movementCredit && totals.closingDebit === totals.closingCredit,
    rows: out,
    totals: {
      openingDebit: fmt(totals.openingDebit),
      openingCredit: fmt(totals.openingCredit),
      movementDebit: fmt(totals.movementDebit),
      movementCredit: fmt(totals.movementCredit),
      closingDebit: fmt(totals.closingDebit),
      closingCredit: fmt(totals.closingCredit),
    },
  };
}

function computeLedger(companyId: string, currency: string, from: string, to: string, query: URLSearchParams) {
  const search = (query.get('search') ?? '').toLowerCase();
  const accountId = query.get('accountId') ?? '';
  const includeInactive = query.get('includeInactive') === 'true';
  const accounts = accountsOf(companyId)
    .filter((a) => (accountId ? a.id === accountId : true))
    .sort((a, b) => a.code.localeCompare(b.code));

  const items = postedLines(companyId, from, to);
  const journals = new Map(loadState().journals.map((j) => [j.id, j]));

  const result = accounts.map((account) => {
    const own = items.filter((i) => i.account!.id === account.id);
    const opening = own
      .filter((i) => i.before)
      .reduce((acc, i) => acc + amount(i.line.debit) - amount(i.line.credit), 0n);
    let running = opening;
    let totalDebit = 0n;
    let totalCredit = 0n;
    const lines = own
      .filter((i) => i.inRange)
      .sort((a, b) => {
        const byDate = a.entry!.entry_date.localeCompare(b.entry!.entry_date);
        return byDate !== 0 ? byDate : a.entry!.entry_no.localeCompare(b.entry!.entry_no);
      })
      .map((i) => {
        const debit = amount(i.line.debit);
        const credit = amount(i.line.credit);
        totalDebit += debit;
        totalCredit += credit;
        running += debit - credit;
        return {
          entryId: i.entry!.id,
          entryNo: i.entry!.entry_no,
          date: i.entry!.entry_date,
          journal: journals.get(i.entry!.journal_id)?.code ?? '',
          reference: i.entry!.reference,
          description: i.line.description ?? i.entry!.description,
          debit: fmt(debit),
          credit: fmt(credit),
          balance: fmt(running),
        };
      });
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      opening: fmt(opening),
      totalDebit: fmt(totalDebit),
      totalCredit: fmt(totalCredit),
      closing: fmt(opening + totalDebit - totalCredit),
      lines,
      isActive: account.is_active,
    };
  });

  const hasActivity = (a: (typeof result)[number]) =>
    a.lines.length > 0 || amount(a.opening) !== 0n || amount(a.closing) !== 0n;
  const visible = includeInactive ? result : result.filter(hasActivity);
  const filtered = search
    ? visible.filter((a) => hasActivity(a) && `${a.code} ${a.name}`.toLowerCase().includes(search))
    : visible;

  const totals = filtered.reduce(
    (acc, a) => ({
      debit: acc.debit + amount(a.totalDebit),
      credit: acc.credit + amount(a.totalCredit),
    }),
    { debit: 0n, credit: 0n },
  );

  return {
    from,
    to,
    currency,
    accounts: filtered.map(({ isActive: _isActive, ...rest }) => rest),
    totals: { debit: fmt(totals.debit), credit: fmt(totals.credit) },
  };
}

function computeStatements(companyId: string, currency: string, from: string, to: string) {
  const balances = computeTrialBalance(companyId, currency, '1900-01-01', to);
  const period = computeTrialBalance(companyId, currency, from, to);

  const periodByAccount = new Map(period.rows.map((r) => [r.code, r]));
  const accounts = accountsOf(companyId);
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const pl = { revenue: [] as any[], expenses: [] as any[] };
  const bs = { assets: [] as any[], liabilities: [] as any[], equity: [] as any[] };
  let cumulativeRevenue = 0n;
  let cumulativeExpenses = 0n;

  for (const row of balances.rows) {
    const account = byCode.get(row.code);
    if (!account) continue;
    const cumulativeNet =
      amount(row.closingDebit) - amount(row.closingCredit);
    const p = periodByAccount.get(row.code);
    const periodNet = p ? amount(p.movementDebit) - amount(p.movementCredit) : 0n;

    if (account.type === 'revenue') {
      cumulativeRevenue += -cumulativeNet;
      if (periodNet !== 0n) {
        pl.revenue.push({ accountId: account.id, code: account.code, name: account.name, amount: fmt(-periodNet) });
      }
    } else if (account.type === 'expense') {
      cumulativeExpenses += cumulativeNet;
      if (periodNet !== 0n) {
        pl.expenses.push({ accountId: account.id, code: account.code, name: account.name, amount: fmt(periodNet) });
      }
    } else {
      const value = account.type === 'asset' ? cumulativeNet : -cumulativeNet;
      if (value !== 0n) {
        const bucket = account.type === 'asset' ? 'assets' : account.type === 'liability' ? 'liabilities' : 'equity';
        bs[bucket].push({ accountId: account.id, code: account.code, name: account.name, amount: fmt(value) });
      }
    }
  }

  const group = (lines: any[]) => ({
    key: 'total',
    lines,
    total: fmt(lines.reduce((acc, l) => acc + amount(l.amount), 0n)),
  });

  const revenue = group(pl.revenue);
  const expenses = group(pl.expenses);
  const profit = amount(revenue.total) - amount(expenses.total);
  const cumulativeResult = cumulativeRevenue - cumulativeExpenses;
  const totalAssets = amount(group(bs.assets).total);
  const totalLiabilitiesAndEquity =
    amount(group(bs.liabilities).total) + amount(group(bs.equity).total) + cumulativeResult;

  return {
    from,
    to,
    currency,
    profitAndLoss: {
      revenue,
      expenses,
      profit: fmt(profit),
      totalRevenue: revenue.total,
      totalExpenses: expenses.total,
    },
    financialPosition: {
      assets: group(bs.assets),
      liabilities: group(bs.liabilities),
      equity: group(bs.equity),
      unappropriatedResult: fmt(cumulativeResult),
      totalAssets: fmt(totalAssets),
      totalLiabilitiesAndEquity: fmt(totalLiabilitiesAndEquity),
      balanced: totalAssets === totalLiabilitiesAndEquity,
    },
  };
}

function dashboard(companyId: string) {
  const s = loadState();
  const { company } = requireCompany(companyId);
  const accounts = accountsOf(companyId);
  const journals = s.journals.filter((j) => j.company_id === companyId);
  const entries = s.entries.filter((e) => e.company_id === companyId);
  const statements = computeStatements(
    companyId,
    company.presentation_currency,
    company.financial_year_start,
    company.financial_year_end,
  );
  const recent = [...entries]
    .sort((a, b) => (a.entry_date === b.entry_date ? b.entry_no.localeCompare(a.entry_no) : b.entry_date.localeCompare(a.entry_date)))
    .slice(0, 6)
    .map((e) => ({
      id: e.id,
      entry_no: e.entry_no,
      entry_date: e.entry_date,
      description: e.description,
      status: e.status,
      journal_code: s.journals.find((j) => j.id === e.journal_id)?.code ?? '',
      total_debit: entryTotals(e),
    }));

  return {
    kpis: {
      accounts: accounts.length,
      journals: journals.length,
      draftEntries: entries.filter((e) => e.status === 'draft').length,
      postedEntries: entries.filter((e) => e.status === 'posted').length,
      revenue: statements.profitAndLoss.revenue.total,
      expenses: statements.profitAndLoss.expenses.total,
      profit: statements.profitAndLoss.profit,
      balancedSheet: statements.financialPosition.balanced,
      currency: company.presentation_currency,
      totalAssets: statements.financialPosition.totalAssets,
    },
    recentEntries: recent,
    range: { from: company.financial_year_start, to: company.financial_year_end },
  };
}

/* ------------------------------------------------------------------- CSV */

const CSV_LABELS = {
  fr: {
    account: 'Compte',
    date: 'Date',
    journal: 'Journal',
    entryNo: "N° d'écriture",
    reference: 'Référence',
    description: 'Libellé',
    debit: 'Débit',
    credit: 'Crédit',
    code: 'Code',
    balance: 'Solde',
    total: 'TOTAL',
    note: 'EXPORT DE DÉMONSTRATION — calculé dans le navigateur, non réglementaire',
  },
  en: {
    account: 'Account',
    date: 'Date',
    journal: 'Journal',
    entryNo: 'Entry no',
    reference: 'Reference',
    description: 'Description',
    debit: 'Debit',
    credit: 'Credit',
    code: 'Code',
    balance: 'Balance',
    total: 'TOTAL',
    note: 'DEMONSTRATION EXPORT — computed in the browser, not a regulatory document',
  },
};

function csv(rows: (string | number | null)[][]): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return '';
    let text = String(value);
    const numeric = /^-?\d+(\.\d+)?$/.test(text);
    if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";,\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${rows.map((r) => r.map(escape).join(';')).join('\r\n')}\r\n`;
}

function exportCsv(path: string, query: URLSearchParams, locale: 'fr' | 'en'): string {
  const s = loadState();
  const user = currentUser();
  const companyMatch = /^\/companies\/([^/]+)\/reports\/([a-z-]+)/.exec(path.split('?')[0]!);
  if (!companyMatch) throw new ApiError(404, 'NOT_FOUND', 'Rapport inconnu');
  const companyId = companyMatch[1]!;
  const report = companyMatch[2] as 'ledger' | 'trial-balance' | 'statements';
  const { company } = requireCompany(companyId);
  const from = query.get('from') || company.financial_year_start;
  const to = query.get('to') || company.financial_year_end;
  const labels = CSV_LABELS[user?.locale ?? locale];

  if (report === 'ledger') {
    const ledger = computeLedger(companyId, company.functional_currency, from, to, query);
    const rows: (string | number | null)[][] = [
      [labels.account, labels.date, labels.journal, labels.entryNo, labels.reference, labels.description, labels.debit, labels.credit],
    ];
    for (const account of ledger.accounts) {
      for (const line of account.lines) {
        rows.push([
          `${account.code} ${account.name}`,
          line.date,
          line.journal,
          line.entryNo,
          line.reference ?? '',
          line.description,
          line.debit,
          line.credit,
        ]);
      }
    }
    rows.push([]);
    rows.push([labels.note]);
    return csv(rows);
  }

  if (report === 'trial-balance') {
    const tb = computeTrialBalance(companyId, company.functional_currency, from, to);
    const rows: (string | number | null)[][] = [
      [labels.code, labels.account, `${labels.balance} D`, `${labels.balance} C`],
    ];
    for (const r of tb.rows) {
      rows.push([r.code, r.name, r.closingDebit, r.closingCredit]);
    }
    rows.push([]);
    rows.push([labels.note]);
    return csv(rows);
  }

  const statements = computeStatements(companyId, company.presentation_currency, from, to);
  const rows: (string | number | null)[][] = [[labels.account, labels.balance]];
  for (const line of statements.financialPosition.assets.lines) rows.push([line.name, line.amount]);
  rows.push([labels.total, statements.financialPosition.totalAssets]);
  for (const line of statements.financialPosition.liabilities.lines) rows.push([line.name, line.amount]);
  for (const line of statements.financialPosition.equity.lines) rows.push([line.name, line.amount]);
  rows.push([labels.total, statements.financialPosition.totalLiabilitiesAndEquity]);
  for (const line of statements.profitAndLoss.revenue.lines) rows.push([line.name, line.amount]);
  for (const line of statements.profitAndLoss.expenses.lines) rows.push([line.name, line.amount]);
  rows.push([labels.total, statements.profitAndLoss.profit]);
  rows.push([]);
  rows.push([labels.note]);
  return csv(rows);
}

/* --------------------------------------------------------------- dispatch */

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';


/* ------------------------------------------------------- module security */

type ModuleKey = 'cabinet' | 'accounting' | 'billing' | 'payroll';
type Access = 'none' | 'read' | 'write' | 'admin';

const ACCESS_WEIGHT: Record<Access, number> = { none: 0, read: 1, write: 2, admin: 3 };

/**
 * Same defaults as the API (apps/api/src/lib/permissions.ts). Payroll and
 * accounting stay disjoint on purpose: the browser demo must not suggest that
 * an accounting collaborator can read payroll data.
 */
const ROLE_MODULES: Record<string, Record<ModuleKey, Access>> = {
  owner: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  admin: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  cabinet_admin: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  manager: { cabinet: 'write', accounting: 'write', billing: 'write', payroll: 'none' },
  accountant: { cabinet: 'read', accounting: 'write', billing: 'read', payroll: 'none' },
  billing_clerk: { cabinet: 'read', accounting: 'read', billing: 'write', payroll: 'none' },
  payroll_manager: { cabinet: 'read', accounting: 'read', billing: 'read', payroll: 'write' },
  viewer: { cabinet: 'read', accounting: 'read', billing: 'read', payroll: 'none' },
};

function effectiveModulesFor(companyId: string, userId: string, role: string): Record<ModuleKey, Access> {
  const s = loadState();
  const out = { ...(ROLE_MODULES[role] ?? ROLE_MODULES.viewer!) };
  for (const grant of s.moduleAccess ?? []) {
    if (grant.company_id !== companyId || grant.user_id !== userId) continue;
    if (ACCESS_WEIGHT[grant.access] > ACCESS_WEIGHT[out[grant.module]]) out[grant.module] = grant.access;
  }
  return out;
}

function requireModule(
  companyId: string,
  module: ModuleKey,
  min: Access = 'read',
  allowArchived = false,
) {
  const ctx = requireCompany(companyId);
  const level = effectiveModulesFor(companyId, ctx.user.id, ctx.role)[module];
  if (ACCESS_WEIGHT[level] < ACCESS_WEIGHT[min]) {
    throw new ApiError(403, 'MODULE_FORBIDDEN', "Ce module n'est pas accessible avec vos droits");
  }
  if (min !== 'read' && ctx.company.status === 'archived' && !allowArchived) {
    throw new ApiError(409, 'COMPANY_ARCHIVED', 'Ce dossier est archivé : lecture seule');
  }
  return { company: ctx.company, role: ctx.role, access: level, user: ctx.user };
}

function taskView(s: DemoState, task: DemoTask) {
  const company = s.companies.find((c) => c.id === task.company_id);
  const assignee = s.users.find((u) => u.id === task.assigned_to);
  return {
    ...task,
    company_name: company?.name ?? null,
    assignee_name: assignee?.full_name ?? null,
  };
}

const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'blocked'];

/* -------------------------------------------------- cabinet (demo) routes */

function cabinetDashboard(s: DemoState, user: DemoUser) {
  const companies = s.members
    .filter((m) => m.user_id === user.id)
    .map((m) => s.companies.find((c) => c.id === m.company_id))
    .filter((c): c is DemoCompany => !!c)
    .filter((c) => effectiveModulesFor(c.id, user.id, s.members.find((m) => m.company_id === c.id && m.user_id === user.id)!.role).cabinet !== 'none');
  const ids = new Set(companies.map((c) => c.id));
  const tasks = s.tasks.filter((t) => ids.has(t.company_id));
  const open = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
  const today = todayIso();
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const byCategory = new Map<string, number>();
  for (const task of open) byCategory.set(task.category, (byCategory.get(task.category) ?? 0) + 1);
  const companiesWithOpenTasks = new Set(open.map((t) => t.company_id));
  const collaborators = new Set(s.members.filter((m) => ids.has(m.company_id)).map((m) => m.user_id));

  return {
    metrics: {
      clients: companies.length,
      active: companies.filter((c) => c.status === 'active').length,
      archived: companies.filter((c) => c.status === 'archived').length,
      toReview: companiesWithOpenTasks.size,
      openTasks: open.length,
      overdueTasks: open.filter((t) => t.due_date && t.due_date < today).length,
      dueSoon: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= soon).length,
      collaborators: collaborators.size,
    },
    tasksByCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
    upcoming: open
      .filter((t) => !!t.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 10)
      .map((t) => taskView(s, t)),
    recentActivity: s.audit
      .filter((a) => a.company_id && ids.has(a.company_id))
      .slice(-12)
      .reverse()
      .map((a) => ({
        id: a.id,
        action: a.action,
        entity_type: a.entity_type,
        created_at: a.created_at,
        company_name: s.companies.find((c) => c.id === a.company_id)?.name ?? null,
        user_name: a.user_email,
      })),
    dossiers: companies.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      client_code: c.client_code,
      financial_year_end: c.financial_year_end,
      open_tasks: open.filter((t) => t.company_id === c.id).length,
    })),
  };
}

export function demoRequest<T>(method: Method, rawPath: string, body?: unknown): T {
  const [path, search] = rawPath.split('?');
  const query = new URLSearchParams(search ?? '');
  const s = loadState();
  const p = path ?? '';
  const payload = (body ?? {}) as Record<string, any>;

  // ---------------------------------------------------------------- auth
  if (p === '/auth/login' && method === 'POST') {
    const user = s.users.find(
      (u) => u.email.toLowerCase() === String(payload.email ?? '').trim().toLowerCase(),
    );
    if (!user || user.password !== String(payload.password ?? '')) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Identifiants incorrects');
    }
    s.session = user.id;
    if (payload.locale === 'fr' || payload.locale === 'en') user.locale = payload.locale;
    audit(null, 'user.login', 'user', user.id);
    persist();
    return { user: publicUser(user) } as T;
  }

  if (p === '/auth/register' && method === 'POST') {
    const email = String(payload.email ?? '').trim();
    const password = String(payload.password ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Adresse e-mail invalide');
    }
    if (password.length < 10) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Mot de passe trop court (10 caractères minimum)');
    }
    if (s.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new ApiError(409, 'CONFLICT', 'Un compte existe déjà avec cette adresse');
    }
    const user: DemoUser = {
      id: uid(),
      email,
      password,
      full_name: String(payload.fullName ?? 'Utilisateur démo'),
      locale: (payload.locale as 'fr' | 'en') ?? 'fr',
    };
    s.users.push(user);
    s.session = user.id;
    audit(null, 'user.register', 'user', user.id);
    persist();
    return { user: publicUser(user) } as T;
  }

  if (p === '/auth/logout' && method === 'POST') {
    const user = currentUser();
    s.session = null;
    if (user) audit(null, 'user.logout', 'user', user.id);
    persist();
    return { ok: true } as T;
  }

  if (p === '/auth/me' && method === 'GET') {
    return { user: publicUser(requireUser()) } as T;
  }

  if (p === '/auth/me' && method === 'PATCH') {
    const user = requireUser();
    if (payload.fullName) user.full_name = String(payload.fullName).trim();
    if (payload.locale === 'fr' || payload.locale === 'en') user.locale = payload.locale;
    let sessionsInvalidated = false;
    if (payload.newPassword) {
      if (user.password !== String(payload.currentPassword ?? '')) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mot de passe actuel incorrect');
      }
      if (String(payload.newPassword).length < 10) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mot de passe trop court (10 caractères minimum)');
      }
      user.password = String(payload.newPassword);
      s.session = null;
      sessionsInvalidated = true;
    }
    audit(null, 'user.update', 'user', user.id);
    persist();
    return { user: publicUser(user), sessionsInvalidated } as T;
  }


  // ------------------------------------------------------------- cabinet
  if (p === '/cabinet/dashboard' && method === 'GET') {
    return cabinetDashboard(s, requireUser()) as T;
  }

  if (p === '/cabinet/companies' && method === 'GET') {
    const user = requireUser();
    const status = query.get('status');
    const search = (query.get('search') ?? '').toLowerCase();
    const manager = query.get('manager');
    const rows = s.members
      .filter((m) => m.user_id === user.id)
      .map((m) => {
        const company = s.companies.find((c) => c.id === m.company_id);
        if (!company) return null;
        const modules = effectiveModulesFor(company.id, user.id, m.role);
        if (modules.cabinet === 'none') return null;
        const dossierManager = s.users.find((u) => u.id === company.dossier_manager_id);
        return {
          ...company,
          role: m.role,
          modules,
          dossier_manager_name: dossierManager?.full_name ?? null,
          open_tasks: s.tasks.filter(
            (t) => t.company_id === company.id && OPEN_TASK_STATUSES.includes(t.status),
          ).length,
        };
      })
      .filter((c): c is NonNullable<typeof c> => !!c)
      .filter((c) => (status && status !== 'all' ? c.status === status : true))
      .filter((c) => (manager ? c.dossier_manager_id === manager : true))
      .filter((c) =>
        search
          ? `${c.name} ${c.brn ?? ''} ${c.client_code ?? ''}`.toLowerCase().includes(search)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return { companies: rows } as T;
  }

  const cabinetMatch = /^\/cabinet\/companies\/([0-9a-f-]{36})(?:\/(archive|unarchive|members))?(?:\/([0-9a-f-]{36}))?$/.exec(p);
  if (cabinetMatch) {
    const companyId = cabinetMatch[1]!;
    const action = cabinetMatch[2];
    const memberId = cabinetMatch[3];

    if (action === 'archive' && method === 'POST') {
      const ctx = requireModule(companyId, 'cabinet', 'admin', true);
      ctx.company.status = 'archived';
      ctx.company.archived_at = now();
      audit(companyId, 'cabinet.archive', 'company', companyId);
      persist();
      return { company: ctx.company } as T;
    }

    if (action === 'unarchive' && method === 'POST') {
      const ctx = requireModule(companyId, 'cabinet', 'admin', true);
      ctx.company.status = 'active';
      ctx.company.archived_at = null;
      audit(companyId, 'cabinet.unarchive', 'company', companyId);
      persist();
      return { company: ctx.company } as T;
    }

    if (action === 'members' && memberId && method === 'PATCH') {
      requireModule(companyId, 'cabinet', 'admin', true);
      const member = s.members.find((m) => m.company_id === companyId && m.user_id === memberId);
      if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Collaborateur introuvable');
      if (typeof payload.role === 'string' && member.role !== 'owner') member.role = payload.role;
      if (payload.isActive !== undefined) {
        const target = s.users.find((u) => u.id === memberId);
        if (target) (target as DemoUser & { is_active?: boolean }).is_active = !!payload.isActive;
      }
      if (payload.modules && typeof payload.modules === 'object') {
        for (const [module, access] of Object.entries(payload.modules as Record<string, string>)) {
          s.moduleAccess = (s.moduleAccess ?? []).filter(
            (g) => !(g.company_id === companyId && g.user_id === memberId && g.module === module),
          );
          if (access !== 'none') {
            s.moduleAccess.push({
              company_id: companyId,
              user_id: memberId,
              module: module as ModuleKey,
              access: access as 'read' | 'write' | 'admin',
            });
          }
        }
      }
      audit(companyId, 'cabinet.member.update', 'user', memberId, { role: payload.role });
      persist();
      return {
        member: {
          userId: memberId,
          role: member.role,
          modules: effectiveModulesFor(companyId, memberId, member.role),
        },
      } as T;
    }

    if (!action && method === 'GET') {
      requireModule(companyId, 'cabinet', 'read');
      const company = s.companies.find((c) => c.id === companyId)!;
      const myMember = s.members.find(
        (m) => m.company_id === companyId && m.user_id === requireUser().id,
      )!;
      const manager = s.users.find((u) => u.id === company.dossier_manager_id) ?? null;
      const members = s.members
        .filter((m) => m.company_id === companyId)
        .map((m) => ({
          ...m,
          is_active: true,
          modules: effectiveModulesFor(companyId, m.user_id, m.role),
        }));
      const tasks = s.tasks
        .filter((t) => t.company_id === companyId)
        .sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')))
        .map((t) => taskView(s, t));
      const openTasks = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
      return {
        company,
        manager: manager
          ? { id: manager.id, full_name: manager.full_name, email: manager.email }
          : null,
        role: myMember.role,
        modules: effectiveModulesFor(companyId, requireUser().id, myMember.role),
        members,
        tasks,
        openTasks,
        recentActivity: s.audit
          .filter((a) => a.company_id === companyId)
          .slice(-15)
          .reverse()
          .map((a) => ({
            id: a.id,
            action: a.action,
            entity_type: a.entity_type,
            entity_id: a.entity_id,
            created_at: a.created_at,
            user_name: a.user_email,
          })),
        counts: {
          entries: s.entries.filter((e) => e.company_id === companyId).length,
          accounts: accountsOf(companyId).length,
          openTasks: openTasks.length,
          collaborators: members.length,
        },
      } as T;
    }

    if (!action && method === 'PATCH') {
      requireModule(companyId, 'cabinet', 'admin');
      const company = s.companies.find((c) => c.id === companyId)!;
      if (payload.dossierManagerId !== undefined) {
        company.dossier_manager_id = payload.dossierManagerId || null;
      }
      if (payload.clientCode !== undefined) company.client_code = payload.clientCode || null;
      if (payload.crn !== undefined) company.crn = payload.crn || null;
      audit(companyId, 'cabinet.dossier.update', 'company', companyId, {
        fields: Object.keys(payload),
      });
      persist();
      return { company } as T;
    }
  }

  if (p === '/cabinet/tasks' && method === 'GET') {
    const user = requireUser();
    const visible = new Set(
      s.members
        .filter((m) => m.user_id === user.id)
        .filter((m) => effectiveModulesFor(m.company_id, user.id, m.role).cabinet !== 'none')
        .map((m) => m.company_id),
    );
    const status = query.get('status');
    const category = query.get('category');
    const companyId = query.get('companyId');
    const assignedTo = query.get('assignedTo');
    const overdue = query.get('overdue') === '1';
    const today = todayIso();
    const rows = s.tasks
      .filter((t) => visible.has(t.company_id))
      .filter((t) => (companyId ? t.company_id === companyId : true))
      .filter((t) => (status && status !== 'all' ? t.status === status : true))
      .filter((t) => (category && category !== 'all' ? t.category === category : true))
      .filter((t) => (assignedTo ? t.assigned_to === assignedTo : true))
      .filter((t) => (overdue ? !!t.due_date && t.due_date < today && OPEN_TASK_STATUSES.includes(t.status) : true))
      .sort((a, b) => {
        const aDone = ['done', 'cancelled'].includes(a.status) ? 1 : 0;
        const bDone = ['done', 'cancelled'].includes(b.status) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999'));
      })
      .map((t) => taskView(s, t));
    return { tasks: rows } as T;
  }

  if (p === '/cabinet/team' && method === 'GET') {
    const user = requireUser();
    const visible = new Set(
      s.members
        .filter((m) => m.user_id === user.id)
        .filter((m) => effectiveModulesFor(m.company_id, user.id, m.role).cabinet !== 'none')
        .map((m) => m.company_id),
    );
    const byUser = new Map<
      string,
      {
        userId: string;
        fullName: string;
        email: string;
        isActive: boolean;
        assignments: { companyId: string; companyName: string; role: string }[];
      }
    >();
    for (const member of s.members.filter((m) => visible.has(m.company_id))) {
      const entry = byUser.get(member.user_id) ?? {
        userId: member.user_id,
        fullName: member.full_name,
        email: member.email,
        isActive: true,
        assignments: [],
      };
      entry.assignments.push({
        companyId: member.company_id,
        companyName: s.companies.find((c) => c.id === member.company_id)?.name ?? '',
        role: member.role,
      });
      byUser.set(member.user_id, entry);
    }
    return { collaborators: [...byUser.values()] } as T;
  }

  // ----------------------------------------------------------- companies
  if (p === '/companies' && method === 'GET') {
    const user = requireUser();
    const companies = s.members
      .filter((m) => m.user_id === user.id)
      .map((m) => {
        const company = s.companies.find((c) => c.id === m.company_id);
        if (!company) return null;
        return {
          ...company,
          role: m.role,
          accounts_count: accountsOf(company.id).length,
          open_tasks: s.tasks.filter(
            (t) => t.company_id === company.id && OPEN_TASK_STATUSES.includes(t.status),
          ).length,
          modules: effectiveModulesFor(company.id, user.id, m.role),
        };
      })
      .filter(Boolean);
    return { companies } as T;
  }

  if (p === '/companies' && method === 'POST') {
    const user = requireUser();
    const name = String(payload.name ?? '').trim();
    if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'Le nom est obligatoire');
    const start = String(payload.financialYearStart ?? '');
    const end = String(payload.financialYearEnd ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Dates d’exercice invalides');
    }
    if (payload.brn && s.companies.some((c) => (c.brn ?? '').toLowerCase() === String(payload.brn).toLowerCase())) {
      throw new ApiError(409, 'CONFLICT', 'Une société utilise déjà ce BRN');
    }
    const company: DemoCompany = {
      id: uid(),
      name,
      brn: payload.brn?.trim() || null,
      crn: payload.crn?.trim() || null,
      client_code: payload.clientCode?.trim() || null,
      dossier_manager_id: payload.dossierManagerId ?? null,
      archived_at: null,
      vat_number: payload.vatNumber?.trim() || null,
      registered_address: payload.registeredAddress?.trim() || null,
      business_activity: payload.businessActivity?.trim() || null,
      financial_year_start: start,
      financial_year_end: end,
      functional_currency: payload.functionalCurrency ?? 'MUR',
      presentation_currency: payload.presentationCurrency ?? payload.functionalCurrency ?? 'MUR',
      accounting_standard: payload.accountingStandard ?? 'IFRS',
      status: payload.status ?? 'active',
      locale: (user.locale as 'fr' | 'en') ?? 'fr',
      created_at: now(),
    };
    s.companies.push(company);
    s.members.push({
      id: uid(),
      company_id: company.id,
      user_id: user.id,
      role: 'owner',
      email: user.email,
      full_name: user.full_name,
    });
    s.periods.push({
      id: uid(),
      company_id: company.id,
      name: 'FY 1',
      start_date: start,
      end_date: end,
      status: 'open',
    });
    if (payload.withDefaultChart !== false) {
      for (const template of DEMO_SEED.accounts) {
        s.accounts.push({
          id: uid(),
          company_id: company.id,
          code: template.code,
          name: template.name,
          type: template.type as DemoAccount['type'],
          parent_id: null,
          currency: template.currency,
          is_active: true,
          fs_mapping: template.fs_mapping,
          description: template.description,
        });
      }
    }
    for (const template of DEMO_SEED.journals) {
      s.journals.push({
        id: uid(),
        company_id: company.id,
        code: template.code,
        name: template.name,
        type: template.type,
        is_active: true,
      });
    }
    audit(company.id, 'company.create', 'company', company.id, { name });
    persist();
    return { company } as T;
  }

  const companyMatch = /^\/companies\/([0-9a-f-]{36})(\/.*)?$/.exec(p);
  if (companyMatch) {
    const companyId = companyMatch[1]!;
    const rest = companyMatch[2] ?? '';
    const { company } = requireCompany(companyId);

    // An archived dossier is read-only (same rule as the API).
    if (company.status === 'archived' && method !== 'GET') {
      throw new ApiError(409, 'COMPANY_ARCHIVED', 'Ce dossier est archivé : lecture seule');
    }

    if (rest === '' && method === 'GET') {
      return {
        company,
        role: s.members.find((m) => m.company_id === companyId && m.user_id === requireUser().id)?.role,
        periods: s.periods.filter((x) => x.company_id === companyId).sort((a, b) => b.start_date.localeCompare(a.start_date)),
      } as T;
    }

    if (rest === '' && method === 'PATCH') {
      const merged = { ...company, ...sanitiseCompanyPatch(payload) };
      if (merged.brn && s.companies.some((c) => c.id !== companyId && (c.brn ?? '').toLowerCase() === String(merged.brn).toLowerCase())) {
        throw new ApiError(409, 'CONFLICT', 'Une société utilise déjà ce BRN');
      }
      Object.assign(company, merged);
      audit(companyId, 'company.update', 'company', companyId, { fields: Object.keys(payload) });
      persist();
      return { company } as T;
    }


    // ---------------------------------------------------------- tasks
    if (rest === '/tasks' && method === 'GET') {
      requireModule(companyId, 'cabinet', 'read');
      const rows = s.tasks
        .filter((t) => t.company_id === companyId)
        .sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')))
        .map((t) => taskView(s, t));
      return { tasks: rows } as T;
    }

    if (rest === '/tasks' && method === 'POST') {
      const ctx = requireModule(companyId, 'cabinet', 'write');
      const title = String(payload.title ?? '').trim();
      if (title.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', 'Titre trop court');
      if (payload.assignedTo) {
        const isMember = s.members.some(
          (m) => m.company_id === companyId && m.user_id === payload.assignedTo,
        );
        if (!isMember) {
          throw new ApiError(400, 'ASSIGNEE_NOT_MEMBER', "Ce collaborateur n'appartient pas au dossier");
        }
      }
      const task: DemoTask = {
        id: uid(),
        company_id: companyId,
        title,
        description: payload.description ? String(payload.description) : null,
        category: String(payload.category ?? 'accounting'),
        priority: String(payload.priority ?? 'normal'),
        status: String(payload.status ?? 'todo'),
        due_date: payload.dueDate || null,
        assigned_to: payload.assignedTo || null,
        created_by: ctx.user.id,
        completed_at: payload.status === 'done' ? now() : null,
        created_at: now(),
        updated_at: now(),
      };
      s.tasks.push(task);
      audit(companyId, 'cabinet.task.create', 'cabinet_task', task.id, { title });
      persist();
      return { task: taskView(s, task) } as T;
    }

    const taskMatch = /^\/tasks\/([0-9a-f-]{36})(\/comments)?$/.exec(rest);
    if (taskMatch) {
      const task = s.tasks.find((t) => t.id === taskMatch[1] && t.company_id === companyId);
      if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', 'Tâche introuvable');

      if (!taskMatch[2] && method === 'GET') {
        requireModule(companyId, 'cabinet', 'read');
        return {
          task: taskView(s, task),
          comments: s.taskComments
            .filter((c) => c.task_id === task.id)
            .map((c) => ({
              ...c,
              author_name: s.users.find((u) => u.id === c.author_id)?.full_name ?? null,
            })),
          history: s.audit
            .filter((a) => a.entity_type === 'cabinet_task' && a.entity_id === task.id)
            .slice()
            .reverse()
            .map((a) => ({
              id: a.id,
              action: a.action,
              created_at: a.created_at,
              user_name: a.user_email,
            })),
        } as T;
      }

      if (!taskMatch[2] && method === 'PATCH') {
        const ctx = requireModule(companyId, 'cabinet', 'write');
        if (payload.assignedTo) {
          const isMember = s.members.some(
            (m) => m.company_id === companyId && m.user_id === payload.assignedTo,
          );
          if (!isMember) {
            throw new ApiError(400, 'ASSIGNEE_NOT_MEMBER', "Ce collaborateur n'appartient pas au dossier");
          }
        }
        const previousStatus = task.status;
        if (payload.title !== undefined) task.title = String(payload.title).trim();
        if (payload.description !== undefined) task.description = payload.description || null;
        if (payload.category !== undefined) task.category = String(payload.category);
        if (payload.priority !== undefined) task.priority = String(payload.priority);
        if (payload.status !== undefined) task.status = String(payload.status);
        if (payload.dueDate !== undefined) task.due_date = payload.dueDate || null;
        if (payload.assignedTo !== undefined) task.assigned_to = payload.assignedTo || null;
        task.updated_at = now();
        task.completed_at = task.status === 'done' ? task.completed_at ?? now() : null;
        if (payload.comment) {
          s.taskComments.push({
            id: uid(),
            task_id: task.id,
            company_id: companyId,
            author_id: ctx.user.id,
            body: String(payload.comment),
            created_at: now(),
          });
        }
        audit(
          companyId,
          payload.status && payload.status !== previousStatus
            ? 'cabinet.task.status'
            : 'cabinet.task.update',
          'cabinet_task',
          task.id,
          { from: previousStatus, to: task.status },
        );
        persist();
        return { task: taskView(s, task) } as T;
      }

      if (taskMatch[2] && method === 'POST') {
        const ctx = requireModule(companyId, 'cabinet', 'write');
        const body = String(payload.body ?? '').trim();
        if (!body) throw new ApiError(400, 'VALIDATION_ERROR', 'Commentaire vide');
        const comment: DemoTaskComment = {
          id: uid(),
          task_id: task.id,
          company_id: companyId,
          author_id: ctx.user.id,
          body,
          created_at: now(),
        };
        s.taskComments.push(comment);
        audit(companyId, 'cabinet.task.comment', 'cabinet_task', task.id);
        persist();
        return { comment } as T;
      }

      if (!taskMatch[2] && method === 'DELETE') {
        const ctx = requireModule(companyId, 'cabinet', 'write');
        if (ACCESS_WEIGHT[ctx.access] < ACCESS_WEIGHT.admin && task.created_by !== ctx.user.id) {
          throw new ApiError(403, 'FORBIDDEN', 'Suppression réservée à un administrateur cabinet');
        }
        s.tasks = s.tasks.filter((t) => t.id !== task.id);
        s.taskComments = s.taskComments.filter((c) => c.task_id !== task.id);
        audit(companyId, 'cabinet.task.delete', 'cabinet_task', task.id);
        persist();
        return { ok: true } as T;
      }
    }

    // --------------------------------------------- billing (foundation)
    if (rest === '/billing/documents' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      return { documents: [], available: false } as T;
    }

    if (rest === '/billing/summary' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      return {
        available: false,
        counts: [],
        capabilities: {
          numbering: false,
          vatComputation: false,
          mraEInvoicing: false,
          postingToAccounting: false,
        },
      } as T;
    }

    if (rest === '/billing/documents' && method === 'POST') {
      requireModule(companyId, 'billing', 'write');
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Facturation préparée mais non implémentée');
    }

    // ---------------------------------------------- payroll (foundation)
    if (rest === '/payroll/employees' && method === 'GET') {
      requireModule(companyId, 'payroll', 'read');
      return { employees: [], available: false } as T;
    }

    if (rest === '/payroll/summary' && method === 'GET') {
      requireModule(companyId, 'payroll', 'read');
      return {
        available: false,
        activeEmployees: 0,
        capabilities: {
          paye: false,
          csg: false,
          nsf: false,
          payslips: false,
          leaveManagement: false,
          statutoryDeclarations: false,
          accountingTransfer: false,
        },
        notice: 'Les calculs réglementaires ne sont pas implémentés.',
      } as T;
    }

    if ((rest === '/payroll/employees' || rest === '/payroll/runs') && method === 'POST') {
      requireModule(companyId, 'payroll', 'write');
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Paie préparée mais non implémentée');
    }

    // ------------------------------------------------------------ accounts
    if (rest === '/accounts' && method === 'GET') {
      const includeInactive = query.get('includeInactive') === 'true';
      const search = (query.get('search') ?? '').toLowerCase();
      const list = accountsOf(companyId)
        .filter((a) => (includeInactive ? true : a.is_active))
        .filter((a) => (search ? `${a.code} ${a.name}`.toLowerCase().includes(search) : true))
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((a) => ({
          ...a,
          parent_code: a.parent_id ? accountsOf(companyId).find((x) => x.id === a.parent_id)?.code ?? null : null,
        }));
      return { accounts: list } as T;
    }

    if (rest === '/accounts' && method === 'POST') {
      const code = String(payload.code ?? '').trim();
      if (!code) throw new ApiError(400, 'VALIDATION_ERROR', 'Le code est obligatoire');
      if (accountsOf(companyId).some((a) => a.code.toLowerCase() === code.toLowerCase())) {
        throw new ApiError(409, 'ACCOUNT_CODE_TAKEN', 'Ce code de compte existe déjà');
      }
      const account: DemoAccount = {
        id: uid(),
        company_id: companyId,
        code,
        name: String(payload.name ?? '').trim() || code,
        type: (payload.type as DemoAccount['type']) ?? 'asset',
        parent_id: payload.parentId || null,
        currency: payload.currency ?? company.functional_currency,
        is_active: payload.isActive ?? true,
        fs_mapping: payload.fsMapping ?? null,
        description: payload.description ?? null,
      };
      s.accounts.push(account);
      audit(companyId, 'account.create', 'account', account.id, { code });
      persist();
      return { account } as T;
    }

    const accountMatch = /^\/accounts\/([0-9a-f-]{36})$/.exec(rest);
    if (accountMatch) {
      const accountId = accountMatch[1]!;
      const account = s.accounts.find((a) => a.id === accountId && a.company_id === companyId);
      if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable');
      if (method === 'PATCH') {
        Object.assign(account, {
          code: payload.code?.trim() ?? account.code,
          name: payload.name?.trim() ?? account.name,
          type: payload.type ?? account.type,
          parent_id: payload.parentId !== undefined ? payload.parentId || null : account.parent_id,
          currency: payload.currency ?? account.currency,
          is_active: payload.isActive ?? account.is_active,
          fs_mapping: payload.fsMapping !== undefined ? payload.fsMapping : account.fs_mapping,
          description: payload.description !== undefined ? payload.description : account.description,
        });
        audit(companyId, 'account.update', 'account', account.id, { fields: Object.keys(payload) });
        persist();
        return { account } as T;
      }
      if (method === 'DELETE') {
        const used = s.lines.some((l) => l.account_id === accountId);
        if (used) throw new ApiError(409, 'ACCOUNT_IN_USE', 'Compte utilisé par des écritures');
        s.accounts = s.accounts.filter((a) => a.id !== accountId);
        audit(companyId, 'account.delete', 'account', accountId, { code: account.code });
        persist();
        return { ok: true } as T;
      }
    }

    // ------------------------------------------------------------ journals
    if (rest === '/journals' && method === 'GET') {
      return {
        journals: s.journals
          .filter((j) => j.company_id === companyId)
          .sort((a, b) => a.code.localeCompare(b.code)),
      } as T;
    }

    // ------------------------------------------------------------- entries
    if (rest === '/entries' && method === 'GET') {
      return listEntries(companyId, query) as T;
    }

    if (rest === '/entries' && method === 'POST') {
      const user = requireUser();
      const journal = s.journals.find((j) => j.id === payload.journalId && j.company_id === companyId);
      if (!journal) throw new ApiError(400, 'VALIDATION_ERROR', 'Journal invalide');
      const entryDate = String(payload.entryDate ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Date invalide (AAAA-MM-JJ)');
      }
      const description = String(payload.description ?? '').trim();
      if (!description) throw new ApiError(400, 'VALIDATION_ERROR', 'Le libellé est obligatoire');
      const status = payload.status === 'posted' ? 'posted' : 'draft';
      const lines: any[] = Array.isArray(payload.lines) ? payload.lines : [];
      if (lines.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Au moins une ligne est requise');

      assertReferenceFree(companyId, payload.reference);
      const prepared = prepareLines(company, { currency: payload.currency, exchangeRate: payload.exchangeRate, lines });
      if (status === 'posted') {
        if (!prepared.balanced) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Débit et crédit doivent être égaux');
        if (lines.length < 2) throw new ApiError(400, 'ENTRY_TOO_FEW_LINES', 'Deux lignes minimum');
        assertOpenPeriod(companyId, entryDate);
      }

      const entry: DemoEntry = {
        id: uid(),
        company_id: companyId,
        journal_id: journal.id,
        entry_no: nextEntryNo(companyId, journal.code, entryDate),
        entry_date: entryDate,
        reference: payload.reference?.trim() || null,
        description,
        currency: prepared.currency,
        exchange_rate: prepared.fxRate,
        status,
        source: 'manual',
        reversal_of_entry_id: null,
        posted_at: status === 'posted' ? now() : null,
        created_at: now(),
      };
      s.entries.push(entry);
      prepared.lines.forEach((line, index) => {
        s.lines.push({
          id: uid(),
          entry_id: entry.id,
          company_id: companyId,
          account_id: line.accountId,
          line_no: index + 1,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          txn_amount: line.txnAmount,
          txn_currency: line.txnCurrency,
          fx_rate: line.fxRate,
        });
      });
      audit(companyId, status === 'posted' ? 'entry.create_posted' : 'entry.create_draft', 'journal_entry', entry.id, {
        entryNo: entry.entry_no,
        user: user.email,
      });
      persist();
      return entryDetail(companyId, entry.id) as T;
    }

    const entryMatch = /^\/entries\/([0-9a-f-]{36})(\/[a-z]+)?$/.exec(rest);
    if (entryMatch) {
      const entryId = entryMatch[1]!;
      const action = entryMatch[2] ?? '';
      const entry = s.entries.find((e) => e.id === entryId && e.company_id === companyId);
      if (!entry) throw new ApiError(404, 'ENTRY_NOT_FOUND', 'Écriture introuvable');

      if (action === '' && method === 'GET') return entryDetail(companyId, entryId) as T;

      if (action === '' && method === 'PATCH') {
        if (entry.status === 'posted') {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Une écriture validée ne peut pas être modifiée');
        }
        if (entry.source === 'reversal') {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Une contrepassation ne peut pas être modifiée');
        }
        const journal = payload.journalId
          ? s.journals.find((j) => j.id === payload.journalId && j.company_id === companyId)
          : s.journals.find((j) => j.id === entry.journal_id);
        if (!journal) throw new ApiError(400, 'VALIDATION_ERROR', 'Journal invalide');
        const entryDate = payload.entryDate ? String(payload.entryDate) : entry.entry_date;
        if (payload.reference !== undefined) {
          assertReferenceFree(companyId, payload.reference, entry.id);
        }
        const nextCurrency = String(payload.currency ?? entry.currency).toUpperCase();
        const currencyChanged = nextCurrency !== entry.currency.toUpperCase();
        const targetIsForeign = nextCurrency !== company.functional_currency.toUpperCase();
        if (currencyChanged && targetIsForeign && (payload.exchangeRate === undefined || payload.exchangeRate === null)) {
          throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', `Un taux est requis pour ${nextCurrency}`);
        }
        const hasLines = Array.isArray(payload.lines) && payload.lines.length > 0;
        if (currencyChanged && targetIsForeign && !hasLines) {
          throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', 'Resoumettez les lignes avec un taux daté');
        }
        let prepared: ReturnType<typeof prepareLines> | null = null;
        if (hasLines) {
          prepared = prepareLines(company, {
            currency: nextCurrency,
            exchangeRate: currencyChanged ? payload.exchangeRate : (payload.exchangeRate ?? entry.exchange_rate),
            lines: payload.lines,
          });
        }
        if (payload.status === 'posted') {
          const lines = prepared ? prepared.lines : s.lines.filter((l) => l.entry_id === entry.id);
          const balanced = prepared
            ? prepared.balanced
            : journalTotals(entry.id).debit === journalTotals(entry.id).credit &&
              journalTotals(entry.id).debit > 0n;
          if (!balanced) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Débit et crédit doivent être égaux');
          if (lines.length < 2) throw new ApiError(400, 'ENTRY_TOO_FEW_LINES', 'Deux lignes minimum');
          assertOpenPeriod(companyId, entryDate);
        }
        const yearChanged = entryDate.slice(0, 4) !== entry.entry_date.slice(0, 4);
        const journalChanged = journal.id !== entry.journal_id;
        if (yearChanged || journalChanged) {
          entry.entry_no = nextEntryNo(companyId, journal.code, entryDate);
        }
        entry.journal_id = journal.id;
        entry.entry_date = entryDate;
        if (payload.reference !== undefined) entry.reference = payload.reference?.trim() || null;
        if (payload.description) entry.description = String(payload.description).trim();
        if (prepared) {
          entry.currency = prepared.currency;
          entry.exchange_rate = prepared.fxRate;
          s.lines = s.lines.filter((l) => l.entry_id !== entry.id);
          prepared.lines.forEach((line, index) => {
            s.lines.push({
              id: uid(),
              entry_id: entry.id,
              company_id: companyId,
              account_id: line.accountId,
              line_no: index + 1,
              description: line.description,
              debit: line.debit,
              credit: line.credit,
              txn_amount: line.txnAmount,
              txn_currency: line.txnCurrency,
              fx_rate: line.fxRate,
            });
          });
        }
        if (payload.status === 'posted') {
          entry.status = 'posted';
          entry.posted_at = now();
        }
        audit(companyId, 'entry.update_draft', 'journal_entry', entry.id, { fields: Object.keys(payload) });
        persist();
        return entryDetail(companyId, entryId) as T;
      }

      if (action === '' && method === 'DELETE') {
        if (entry.status === 'posted') {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Une écriture validée ne peut pas être supprimée');
        }
        if (s.entries.some((e) => e.reversal_of_entry_id === entry.id)) {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Cette écriture a été contrepassée');
        }
        s.entries = s.entries.filter((e) => e.id !== entry.id);
        s.lines = s.lines.filter((l) => l.entry_id !== entry.id);
        audit(companyId, 'entry.delete_draft', 'journal_entry', entry.id, { entryNo: entry.entry_no });
        persist();
        return { ok: true } as T;
      }

      if (action === '/post' && method === 'POST') {
        if (entry.status !== 'draft') throw new ApiError(409, 'ENTRY_NOT_DRAFT', 'Déjà validée');
        const { debit, credit, lines } = journalTotals(entry.id);
        if (lines.length < 2) throw new ApiError(400, 'ENTRY_TOO_FEW_LINES', 'Deux lignes minimum');
        if (debit !== credit || debit === 0n) {
          throw new ApiError(400, 'ENTRY_UNBALANCED', 'Débit et crédit doivent être égaux');
        }
        const accounts = new Map(accountsOf(companyId).map((a) => [a.id, a]));
        if (lines.some((l) => !accounts.get(l.account_id)?.is_active)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Un compte de cette écriture est désactivé');
        }
        assertOpenPeriod(companyId, entry.entry_date);
        entry.status = 'posted';
        entry.posted_at = now();
        audit(companyId, 'entry.post', 'journal_entry', entry.id, { entryNo: entry.entry_no });
        persist();
        return entryDetail(companyId, entry.id) as T;
      }

      if (action === '/reverse' && method === 'POST') {
        if (entry.status !== 'posted') {
          throw new ApiError(409, 'ENTRY_NOT_POSTED', 'Seule une écriture validée peut être contrepassée');
        }
        if (s.entries.some((e) => e.reversal_of_entry_id === entry.id)) {
          throw new ApiError(409, 'ENTRY_ALREADY_REVERSED', 'Écriture déjà contrepassée');
        }
        const journal = s.journals.find((j) => j.id === entry.journal_id)!;
        const date = payload.entryDate ? String(payload.entryDate) : entry.entry_date;
        assertOpenPeriod(companyId, date);
        const source = s.lines.filter((l) => l.entry_id === entry.id);
        const reversal: DemoEntry = {
          id: uid(),
          company_id: companyId,
          journal_id: entry.journal_id,
          entry_no: nextEntryNo(companyId, journal.code, date),
          entry_date: date,
          reference: entry.reference,
          description: `Contrepassation de ${entry.entry_no}`,
          currency: entry.currency,
          exchange_rate: entry.exchange_rate,
          status: 'posted',
          source: 'reversal',
          reversal_of_entry_id: entry.id,
          posted_at: now(),
          created_at: now(),
        };
        s.entries.push(reversal);
        source.forEach((line, index) => {
          s.lines.push({
            id: uid(),
            entry_id: reversal.id,
            company_id: companyId,
            account_id: line.account_id,
            line_no: index + 1,
            description: line.description,
            debit: line.credit,
            credit: line.debit,
            txn_amount: line.txn_amount,
            txn_currency: line.txn_currency,
            fx_rate: line.fx_rate,
          });
        });
        audit(companyId, 'entry.reverse', 'journal_entry', entry.id, {
          reversalEntryNo: reversal.entry_no,
        });
        persist();
        return entryDetail(companyId, reversal.id) as T;
      }

      if (action === '/attachments' && method === 'POST') {
        throw new ApiError(
          501,
          'DEMO_UNSUPPORTED',
          'Pièces jointes indisponibles en démonstration : elles nécessitent le serveur (aucun fichier n’est envoyé).',
        );
      }
    }

    // -------------------------------------------------------------- reports
    if (rest.startsWith('/reports/') && method === 'GET') {
      const from = query.get('from') || company.financial_year_start;
      const to = query.get('to') || company.financial_year_end;
      if (from > to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'Dates invalides');
      if (rest === '/reports/ledger') {
        return computeLedger(companyId, company.functional_currency, from, to, query) as T;
      }
      if (rest === '/reports/trial-balance') {
        return computeTrialBalance(companyId, company.functional_currency, from, to) as T;
      }
      if (rest === '/reports/statements') {
        return computeStatements(companyId, company.presentation_currency, from, to) as T;
      }
    }

    if (rest === '/dashboard' && method === 'GET') {
      return dashboard(companyId) as T;
    }

    // -------------------------------------------------------------- periods
    if (rest === '/periods' && method === 'POST') {
      const start = String(payload.startDate ?? '');
      const end = String(payload.endDate ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dates de période invalides');
      }
      const overlap = s.periods.some(
        (p) => p.company_id === companyId && start <= p.end_date && end >= p.start_date,
      );
      if (overlap) throw new ApiError(409, 'PERIOD_OVERLAP', 'Cette période en chevauche une autre');
      const period: DemoPeriod = {
        id: uid(),
        company_id: companyId,
        name: String(payload.name ?? 'Période'),
        start_date: start,
        end_date: end,
        status: 'open',
      };
      s.periods.push(period);
      audit(companyId, 'period.create', 'period', period.id, { name: period.name });
      persist();
      return { period } as T;
    }

    const periodMatch = /^\/periods\/([0-9a-f-]{36})\/(close|reopen)$/.exec(rest);
    if (periodMatch) {
      const period = s.periods.find((p) => p.id === periodMatch[1] && p.company_id === companyId);
      if (!period) throw new ApiError(404, 'PERIOD_NOT_FOUND', 'Période introuvable');
      period.status = periodMatch[2] === 'close' ? 'closed' : 'open';
      audit(companyId, `period.${periodMatch[2]}`, 'period', period.id, { name: period.name });
      persist();
      return { period } as T;
    }

    // ---------------------------------------------------------------- rates
    if (rest === '/exchange-rates' && method === 'GET') {
      return { rates: s.rates.filter((r) => r.company_id === companyId) } as T;
    }

    if (rest === '/exchange-rates' && method === 'POST') {
      const rate = parseRate(payload.rate);
      const from = String(payload.fromCurrency ?? '').toUpperCase();
      const to = String(payload.toCurrency ?? '').toUpperCase();
      if (from === to) throw new ApiError(400, 'VALIDATION_ERROR', 'Devises identiques');
      const row: DemoRate = {
        id: uid(),
        company_id: companyId,
        from_currency: from,
        to_currency: to,
        rate_date: String(payload.rateDate ?? todayIso()),
        rate: rateToString(rate),
        source: String(payload.source ?? 'Saisie manuelle (démo)'),
      };
      s.rates.push(row);
      if (to === company.functional_currency && from !== company.functional_currency) {
        s.rates.push({
          id: uid(),
          company_id: companyId,
          from_currency: to,
          to_currency: from,
          rate_date: row.rate_date,
          rate: reciprocal(rate),
          source: 'Taux inverse calculé (démo)',
        });
      }
      audit(companyId, 'exchange_rate.create', 'exchange_rate', row.id, { from, to });
      persist();
      return { rate: row } as T;
    }

    // -------------------------------------------------------------- members
    if (rest === '/members' && method === 'GET') {
      return { members: s.members.filter((m) => m.company_id === companyId) } as T;
    }

    if (rest === '/members' && method === 'POST') {
      const email = String(payload.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Adresse e-mail invalide');
      }
      if (s.members.some((m) => m.company_id === companyId && m.email.toLowerCase() === email)) {
        throw new ApiError(409, 'CONFLICT', 'Ce membre existe déjà');
      }
      const member: DemoMember = {
        id: uid(),
        company_id: companyId,
        user_id: uid(),
        role: (payload.role as DemoMember['role']) ?? 'accountant',
        email,
        full_name: String(payload.fullName ?? email),
      };
      s.members.push(member);
      audit(companyId, 'member.add', 'member', member.id, { email, role: member.role });
      persist();
      return { member } as T;
    }

    const memberMatch = /^\/members\/([0-9a-f-]{36})$/.exec(rest);
    if (memberMatch && method === 'DELETE') {
      const member = s.members.find((m) => m.id === memberMatch[1] && m.company_id === companyId);
      if (!member) throw new ApiError(404, 'NOT_FOUND', 'Membre introuvable');
      if (member.user_id === requireUser().id) {
        throw new ApiError(409, 'CONFLICT', 'Impossible de retirer le propriétaire');
      }
      s.members = s.members.filter((m) => m.id !== member.id);
      audit(companyId, 'member.remove', 'member', member.id, { email: member.email });
      persist();
      return { ok: true } as T;
    }

    // ---------------------------------------------------------------- audit
    if (rest === '/audit' && method === 'GET') {
      const limit = Number(query.get('limit') ?? 100);
      const events = s.audit
        .filter((a) => a.company_id === companyId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
      return { events } as T;
    }
  }

  throw new ApiError(404, 'NOT_FOUND', `Route de démonstration inconnue : ${method} ${p}`);
}

function sanitiseCompanyPatch(payload: Record<string, any>) {
  const patch: Partial<DemoCompany> = {};
  if (payload.name !== undefined) patch.name = String(payload.name).trim();
  if (payload.brn !== undefined) patch.brn = payload.brn?.trim() || null;
  if (payload.vatNumber !== undefined) patch.vat_number = payload.vatNumber?.trim() || null;
  if (payload.registeredAddress !== undefined) {
    patch.registered_address = payload.registeredAddress?.trim() || null;
  }
  if (payload.businessActivity !== undefined) {
    patch.business_activity = payload.businessActivity?.trim() || null;
  }
  if (payload.financialYearStart !== undefined) patch.financial_year_start = payload.financialYearStart;
  if (payload.financialYearEnd !== undefined) patch.financial_year_end = payload.financialYearEnd;
  if (payload.functionalCurrency !== undefined) patch.functional_currency = payload.functionalCurrency;
  if (payload.presentationCurrency !== undefined) patch.presentation_currency = payload.presentationCurrency;
  if (payload.accountingStandard !== undefined) patch.accounting_standard = payload.accountingStandard;
  if (payload.status !== undefined) patch.status = payload.status;
  if (payload.locale !== undefined) patch.locale = payload.locale;
  if (payload.crn !== undefined) patch.crn = payload.crn?.trim() || null;
  if (payload.clientCode !== undefined) patch.client_code = payload.clientCode?.trim() || null;
  if (payload.dossierManagerId !== undefined) {
    patch.dossier_manager_id = payload.dossierManagerId || null;
  }
  if (patch.status !== undefined) {
    patch.archived_at = patch.status === 'archived' ? now() : null;
  }
  return patch;
}

/** CSV export (returns the text). PDF is not generated in the browser. */
export function demoCsv(path: string, format: 'csv' | 'pdf'): { text?: string; mode: 'download' | 'print' } {
  if (format === 'pdf') return { mode: 'print' };
  const [base, search] = path.split('?');
  const query = new URLSearchParams(search ?? '');
  const user = currentUser();
  return { text: exportCsv(base ?? '', query, user?.locale ?? 'fr'), mode: 'download' };
}
