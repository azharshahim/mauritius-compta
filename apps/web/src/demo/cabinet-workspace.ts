/**
 * Mission 44 — browser demonstration backend for the Accountant Workspace.
 *
 * The GitHub Pages bundle has no server: this module serves the very same
 * `/cabinet/workspace*` routes from localStorage, with the same rules as
 * apps/api/src/modules/cabinet-onboarding:
 *   - one `companies` array remains the single client repository;
 *   - progress is computed by the very same pure engine (`computeOnboardingProgress`);
 *   - drafts belong to their author; KYC verification needs cabinet admin;
 *   - activation performs the same checks and provisions the same defaults.
 *
 * Every record is fictitious and stays in this browser only.
 */
import { ApiError } from '../errors';
import { DEMO_SEED } from './seed-data';
import {
  ACCOUNTING_BASES,
  CHART_CHOICES,
  KYC_REVIEW_STATUSES,
  KYC_STATUSES,
  KYC_TEMPLATE,
  LEGAL_FORMS,
  MODULE_CATALOGUE,
  OPENING_BALANCE_CHOICES,
  SECTORS,
  SUPPORTED_CURRENCIES,
  TAX_REGISTRATION_CHOICES,
  isModuleCode,
  normaliseAccountingSetup,
  sectorDefinition,
} from '../../../api/src/modules/cabinet-onboarding/catalogue';
import {
  computeOnboardingProgress,
  defaultKycChecks,
  normaliseModules,
  type OnboardingStepKey,
} from '../../../api/src/modules/cabinet-onboarding/progress';

type Access = 'none' | 'read' | 'write' | 'admin';
const WEIGHT: Record<Access, number> = { none: 0, read: 1, write: 2, admin: 3 };

export interface DemoOnboarding {
  company_id: string;
  status: 'not_started' | 'in_progress' | 'pending_review' | 'approved' | 'rejected';
  kyc_review_status: 'not_started' | 'in_progress' | 'pending_review' | 'approved' | 'rejected';
  current_step: number;
  sector: string | null;
  sector_notes: string | null;
  accounting_setup: Record<string, unknown>;
  selected_modules: string[];
  assigned_accountant_id: string | null;
  activated_at: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface DemoKycCheck {
  id: string;
  company_id: string;
  key: string;
  category: string;
  required: boolean;
  status: string;
  document_ref: string | null;
  note: string | null;
  updated_at: string;
}

export interface DemoClientDraft {
  id: string;
  owner_user_id: string;
  current_step: number;
  payload: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface DemoCabinetWorkspaceState {
  onboardings: DemoOnboarding[];
  kycChecks: DemoKycCheck[];
  drafts: DemoClientDraft[];
}

export interface WorkspaceContext {
  state: any;
  uid: () => string;
  now: () => string;
  persist: () => void;
  audit: (
    companyId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    details?: Record<string, unknown>,
  ) => void;
  requireUser: () => { id: string; email: string; full_name: string; locale: string };
  requireCompany: (companyId: string) => {
    company: any;
    role: string;
    user: { id: string; email: string; full_name: string; locale: string };
  };
  effectiveModules: (companyId: string, userId: string, role: string) => Record<string, Access>;
}

/* ------------------------------------------------------------------ seeding */

const COMPLETE_SETUP = {
  accountingBasis: 'accrual',
  chartChoice: 'provisional_template',
  openingBalanceChoice: 'later',
  taxRegistration: 'to_confirm',
  bankAccountsReviewed: true,
  vatRegistered: false,
  notes: null,
};

function seedChecks(
  ws: DemoCabinetWorkspaceState,
  companyId: string,
  statuses: Record<string, string>,
  setter: WorkspaceSeedHelpers,
): void {
  for (const item of defaultKycChecks()) {
    ws.kycChecks.push({
      id: setter.uid(),
      company_id: companyId,
      key: item.key,
      category: item.category,
      required: item.required,
      status: statuses[item.key] ?? (item.required ? 'not_started' : 'not_started'),
      document_ref: ['received', 'verified'].includes(statuses[item.key] ?? '')
        ? `dossier fictif / ${item.key}.pdf`
        : null,
      note: null,
      updated_at: setter.now(),
    });
  }
}

interface WorkspaceSeedHelpers {
  uid: () => string;
  now: () => string;
}

/**
 * Fictional onboarding states, one per scenario the accountant must judge:
 * completed file, missing documents, KYC awaiting review, untouched file and a
 * draft waiting to be resumed.
 */
export function seedDemoCabinetWorkspace(state: any, helpers: WorkspaceSeedHelpers): DemoCabinetWorkspaceState {
  const seeded: DemoCabinetWorkspaceState = { onboardings: [], kycChecks: [], drafts: [] };
  state.cabinetWorkspace = seeded;
  const companies = (state.companies ?? []) as any[];
  const users = (state.users ?? []) as any[];
  const admin = users[0];
  const accountant = users[1];
  if (!admin) return seeded;

  const allVerified: Record<string, string> = {};
  for (const item of KYC_TEMPLATE) allVerified[item.key] = 'verified';

  const partial: Record<string, string> = {
    company_registration_certificate: 'verified',
    business_registration_number_proof: 'verified',
    directors_register: 'received',
    authorised_representatives: 'received',
    beneficial_owners_register: 'missing',
    director_identity_documents: 'received',
    brn_certificate: 'verified',
    business_address_proof: 'requested',
  };

  const pending: Record<string, string> = {};
  for (const item of KYC_TEMPLATE) pending[item.key] = item.required ? 'received' : 'not_applicable';

  const [main, retail, hospitality, logistics, services] = companies;
  const add = (
    company: any,
    data: Omit<DemoOnboarding, 'company_id' | 'created_at' | 'updated_at' | 'last_activity_at'> & {
      last_activity_at?: string;
    },
  ) => {
    if (!company) return;
    const timestamp = helpers.now();
    seeded.onboardings.push({
      ...data,
      company_id: company.id,
      last_activity_at: data.last_activity_at ?? timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });
    return company;
  };

  if (main) {
    add(main, {
      status: 'approved',
      kyc_review_status: 'approved',
      current_step: 6,
      sector: 'trading_retail',
      sector_notes: 'Fictional retail dossier, used for the review tour.',
      accounting_setup: COMPLETE_SETUP,
      selected_modules: ['onboarding_kyc', 'sector_instances', 'checks_balances', 'sales_einvoicing', 'purchases_ocr', 'tax_management', 'reports'],
      assigned_accountant_id: admin.id,
      activated_at: helpers.now(),
    });
    seedChecks(seeded, main.id, allVerified, helpers);
  }

  if (retail) {
    add(retail, {
      status: 'in_progress',
      kyc_review_status: 'in_progress',
      current_step: 2,
      sector: 'professional_services',
      sector_notes: null,
      accounting_setup: { ...COMPLETE_SETUP, chartChoice: null, openingBalanceChoice: null },
      selected_modules: ['onboarding_kyc', 'sector_instances', 'checks_balances', 'sales_einvoicing', 'reports'],
      assigned_accountant_id: accountant?.id ?? null,
      activated_at: null,
    });
    seedChecks(seeded, retail.id, partial, helpers);
  }

  if (hospitality) {
    add(hospitality, {
      status: 'pending_review',
      kyc_review_status: 'pending_review',
      current_step: 6,
      sector: 'hospitality_tourism',
      sector_notes: 'Seasonal activity: cash controls to confirm with the client.',
      accounting_setup: COMPLETE_SETUP,
      selected_modules: ['onboarding_kyc', 'sector_instances', 'checks_balances', 'sales_einvoicing', 'purchases_ocr', 'tax_management', 'reports'],
      assigned_accountant_id: accountant?.id ?? null,
      activated_at: null,
    });
    seedChecks(seeded, hospitality.id, pending, helpers);
  }

  if (logistics) {
    add(logistics, {
      status: 'not_started',
      kyc_review_status: 'not_started',
      current_step: 1,
      sector: null,
      sector_notes: null,
      accounting_setup: {},
      selected_modules: [],
      assigned_accountant_id: null,
      activated_at: null,
    });
  }

  if (services) {
    add(services, {
      status: 'in_progress',
      kyc_review_status: 'not_started',
      current_step: 3,
      sector: 'transport_logistics',
      sector_notes: null,
      accounting_setup: { ...COMPLETE_SETUP, bankAccountsReviewed: false },
      selected_modules: ['onboarding_kyc', 'checks_balances', 'reports'],
      assigned_accountant_id: null,
      activated_at: null,
    });
  }

  seeded.drafts.push({
    id: helpers.uid(),
    owner_user_id: admin.id,
    current_step: 3,
    payload: {
      company: {
        name: 'Fictional Coral Services Ltd',
        tradeName: 'Coral Services',
        brn: 'DEMO-BRN-0100',
        legalForm: 'private_company',
        address: '5, Fictitious Street, Curepipe (fictional)',
        contactEmail: 'contact@coral-fictif.test',
        businessDescription: 'Fictional management services company (demo).',
      },
      financial: {
        financialYearStart: '2025-07-01',
        financialYearEnd: '2026-06-30',
        functionalCurrency: 'MUR',
        presentationCurrency: 'MUR',
        accountingStandard: 'IFRS',
      },
      sector: 'professional_services',
      modules: ['onboarding_kyc', 'checks_balances', 'reports'],
      accountingSetup: { ...COMPLETE_SETUP, openingBalanceChoice: null },
    },
    created_at: helpers.now(),
    updated_at: helpers.now(),
  });

  return seeded;
}

/* ------------------------------------------------------------------ helpers */

const workspace = (state: any): DemoCabinetWorkspaceState => {
  if (!state.cabinetWorkspace) {
    state.cabinetWorkspace = { onboardings: [], kycChecks: [], drafts: [] };
  }
  const ws = state.cabinetWorkspace as DemoCabinetWorkspaceState;
  ws.onboardings ??= [];
  ws.kycChecks ??= [];
  ws.drafts ??= [];
  return ws;
};

const onboardingOf = (state: any, companyId: string): DemoOnboarding | undefined =>
  workspace(state).onboardings.find((o) => o.company_id === companyId);

const checksOf = (state: any, companyId: string): DemoKycCheck[] =>
  workspace(state).kycChecks.filter((c) => c.company_id === companyId);

const view = (state: any, companyId: string) => {
  const row = onboardingOf(state, companyId);
  if (!row) {
    return {
      company_id: companyId,
      status: 'not_started',
      kyc_review_status: 'not_started',
      current_step: 1,
      sector: null,
      sector_notes: null,
      accounting_setup: {},
      selected_modules: [],
      assigned_accountant_id: null,
      activated_at: null,
      last_activity_at: null,
      exists: false,
    };
  }
  return {
    ...row,
    accounting_setup: row.accounting_setup ?? {},
    selected_modules: normaliseModules(row.selected_modules),
    exists: true,
  };
};

const progressFor = (company: any, onboarding: any, checks: DemoKycCheck[]) =>
  computeOnboardingProgress({
    company,
    onboarding: {
      sector: onboarding.sector ?? null,
      selected_modules: onboarding.selected_modules ?? [],
      accounting_setup: onboarding.accounting_setup ?? {},
      kyc_review_status: onboarding.kyc_review_status ?? 'not_started',
      status: onboarding.status ?? 'not_started',
      activated_at: onboarding.activated_at ?? null,
    },
    kycChecks: checks.map((c) => ({ key: c.key, status: c.status as any, required: c.required })),
  });

const missingOf = (checks: DemoKycCheck[]) =>
  checks.filter((c) => c.required && ['not_started', 'requested', 'missing'].includes(c.status));

function moduleAccessOrThrow(ctx: WorkspaceContext, companyId: string, min: 'read' | 'write' | 'admin') {
  const { company, role, user } = ctx.requireCompany(companyId);
  const modules = ctx.effectiveModules(companyId, user.id, role);
  if (WEIGHT[modules.cabinet ?? 'none'] < WEIGHT[min]) {
    throw new ApiError(403, 'MODULE_FORBIDDEN', 'Droits cabinet insuffisants pour cette opération');
  }
  return { company, role, user, modules, cabinetAccess: modules.cabinet ?? 'none' };
}

function computeChecks(ctx: WorkspaceContext, companyId: string) {
  const s = ctx.state;
  const entries = (s.entries ?? []).filter((e: any) => e.company_id === companyId);
  const lines = (s.lines ?? []).filter((l: any) =>
    entries.some((e: any) => e.id === l.entry_id && e.status === 'posted'),
  );
  const amount = (v: string | null | undefined) => Number(v ?? 0);
  const byEntry = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const bucket = byEntry.get(line.entry_id) ?? { debit: 0, credit: 0 };
    bucket.debit += amount(line.debit);
    bucket.credit += amount(line.credit);
    byEntry.set(line.entry_id, bucket);
  }
  let unbalanced = 0;
  let debit = 0;
  let credit = 0;
  for (const total of byEntry.values()) {
    debit += total.debit;
    credit += total.credit;
    if (Math.abs(total.debit - total.credit) > 0.00005) unbalanced += 1;
  }
  const bankAccounts = (s.bankAccounts ?? []).filter(
    (a: any) => a.company_id === companyId && a.is_active !== false,
  ).length;
  const transactions = (s.bankTransactions ?? []).filter((t: any) => t.company_id === companyId);
  const confirmed = new Set(
    (s.bankMatches ?? []).filter((m: any) => m.status === 'confirmed').map((m: any) => m.transaction_id),
  );
  const unreconciled = transactions.filter((t: any) => !confirmed.has(t.id)).length;
  const pendingProposals = (s.mission23?.proposals ?? []).filter(
    (p: any) => p.company_id === companyId && p.status === 'PROPOSED',
  ).length;

  return {
    unpostedEntries: entries.filter((e: any) => e.status === 'draft').length,
    postedEntries: entries.filter((e: any) => e.status === 'posted').length,
    unbalancedEntries: unbalanced,
    trialBalance: { debit, credit, balanced: Math.abs(debit - credit) < 0.00005 },
    openingBalanceBatches: (s.fyOpeningBatches ?? []).filter((b: any) => b.company_id === companyId).length,
    bankAccounts,
    unreconciledTransactions: unreconciled,
    pendingProposals: unreconciled + pendingProposals,
    accounts: (s.accounts ?? []).filter((a: any) => a.company_id === companyId).length,
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/* ------------------------------------------------------------------ handler */

export interface HandledRoute {
  handled: boolean;
  data?: unknown;
}

export function handleDemoCabinetWorkspace(
  ctx: WorkspaceContext,
  method: string,
  path: string,
  query: URLSearchParams,
  payload: Record<string, any>,
): HandledRoute {
  if (!path.startsWith('/cabinet/workspace')) return { handled: false };
  const s = ctx.state;
  const ws = workspace(s);
  const user = ctx.requireUser();

  /* ------------------------------------------------------------- options */
  if (path === '/cabinet/workspace/options' && method === 'GET') {
    return {
      handled: true,
      data: {
        sectors: SECTORS,
        modules: MODULE_CATALOGUE,
        kycTemplate: KYC_TEMPLATE,
        legalForms: LEGAL_FORMS,
        currencies: SUPPORTED_CURRENCIES,
        accountingBases: ACCOUNTING_BASES,
        chartChoices: CHART_CHOICES,
        openingBalanceChoices: OPENING_BALANCE_CHOICES,
        taxRegistrations: TAX_REGISTRATION_CHOICES,
        kycStatuses: KYC_STATUSES,
        kycReviewStatuses: KYC_REVIEW_STATUSES,
        steps: ['company_information', 'kyc', 'sector', 'accounting_setup', 'modules', 'activation'],
        legalValidation: false,
      },
    };
  }

  /* ------------------------------------------------------------- clients */
  const clientMatch = /^\/cabinet\/workspace\/clients\/([0-9a-f-]{36})(?:\/onboarding(?:\/kyc\/([a-z0-9_]+))?)?$/.exec(
    path,
  );
  if (clientMatch) {
    const companyId = clientMatch[1]!;
    const isKyc = Boolean(clientMatch[2]);

    if (path.endsWith('/onboarding') && method === 'PATCH') {
      const access = moduleAccessOrThrow(ctx, companyId, 'read');
      if (WEIGHT[access.cabinetAccess] < WEIGHT.write) {
        throw new ApiError(403, 'MODULE_FORBIDDEN', 'Droit d’écriture cabinet requis');
      }
      const needsAdmin =
        payload.kycReviewStatus === 'approved' ||
        payload.kycReviewStatus === 'rejected' ||
        payload.status === 'approved' ||
        payload.status === 'rejected' ||
        payload.assignedAccountantId !== undefined;
      if (needsAdmin && WEIGHT[access.cabinetAccess] < WEIGHT.admin) {
        throw new ApiError(403, 'MODULE_FORBIDDEN', 'Administration du cabinet requise');
      }
      if (payload.assignedAccountantId) {
        const member = (s.members ?? []).some(
          (m: any) => m.company_id === companyId && m.user_id === payload.assignedAccountantId,
        );
        if (!member) throw new ApiError(400, 'VALIDATION_ERROR', 'Comptable non membre de ce dossier');
      }
      const row = onboardingOf(s, companyId);
      const currentSetup = normaliseAccountingSetup(row?.accounting_setup ?? {});
      const setup = payload.accountingSetup
        ? normaliseAccountingSetup({ ...currentSetup, ...payload.accountingSetup })
        : currentSetup;
      const modules =
        payload.selectedModules !== undefined
          ? normaliseModules(payload.selectedModules)
          : normaliseModules(row?.selected_modules ?? []);
      const sector = payload.sector !== undefined ? payload.sector : row?.sector ?? null;
      if (sector && !SECTORS.some((item) => item.key === sector)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Secteur inconnu');
      }
      if (payload.selectedModules && !payload.selectedModules.every((m: string) => isModuleCode(m))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Module inconnu');
      }
      if (payload.status === 'approved') {
        const incomplete: string[] = [];
        if (!sector) incomplete.push('sector');
        if (modules.length === 0) incomplete.push('modules');
        if (
          !setup.accountingBasis ||
          !setup.chartChoice ||
          !setup.openingBalanceChoice ||
          !setup.taxRegistration
        ) {
          incomplete.push('accounting_setup');
        }
        if (incomplete.length > 0) {
          throw new ApiError(409, 'ONBOARDING_INCOMPLETE', 'Dossier client incomplet', incomplete);
        }
      }

      const timestamp = ctx.now();
      const next: DemoOnboarding = row
        ? { ...row }
        : {
            company_id: companyId,
            status: 'in_progress',
            kyc_review_status: 'not_started',
            current_step: 1,
            sector: null,
            sector_notes: null,
            accounting_setup: {},
            selected_modules: [],
            assigned_accountant_id: null,
            activated_at: null,
            last_activity_at: timestamp,
            created_at: timestamp,
            updated_at: timestamp,
          };
      if (payload.sector !== undefined) next.sector = sector;
      if (payload.sectorNotes !== undefined) next.sector_notes = payload.sectorNotes;
      if (payload.currentStep !== undefined) next.current_step = payload.currentStep;
      if (payload.selectedModules !== undefined) next.selected_modules = modules;
      if (payload.accountingSetup !== undefined) next.accounting_setup = setup as any;
      if (payload.kycReviewStatus !== undefined) next.kyc_review_status = payload.kycReviewStatus;
      if (payload.status !== undefined) next.status = payload.status;
      if (payload.assignedAccountantId !== undefined) {
        next.assigned_accountant_id = payload.assignedAccountantId;
      }
      next.last_activity_at = timestamp;
      next.updated_at = timestamp;
      if (payload.status === 'approved' && !next.activated_at) {
        next.activated_at = timestamp;
        next.current_step = 6;
      }
      if (!row) ws.onboardings.push(next);
      else Object.assign(row, next);

      if (!checksOf(s, companyId).length) {
        seedChecks(ws, companyId, {}, { uid: ctx.uid, now: ctx.now });
      }
      if (payload.tradeName !== undefined) access.company.trade_name = payload.tradeName;
      if (payload.legalForm !== undefined) access.company.legal_form = payload.legalForm;
      if (payload.incorporationDate !== undefined) access.company.incorporation_date = payload.incorporationDate;
      if (payload.contactName !== undefined) access.company.contact_name = payload.contactName;
      if (payload.contactEmail !== undefined) access.company.contact_email = payload.contactEmail;
      if (payload.contactPhone !== undefined) access.company.contact_phone = payload.contactPhone;
      if (payload.businessDescription !== undefined) {
        access.company.business_description = payload.businessDescription;
      }
      if (payload.country !== undefined) access.company.country = payload.country;
      if (payload.registeredAddress !== undefined) access.company.registered_address = payload.registeredAddress;

      ctx.audit(
        companyId,
        payload.status === 'approved' ? 'cabinet.onboarding.activate' : 'cabinet.onboarding.update',
        'company',
        companyId,
        { sector, modules, status: payload.status ?? null },
      );
      ctx.persist();
      const onboarding = view(s, companyId);
      const checks = checksOf(s, companyId);
      return {
        handled: true,
        data: {
          onboarding,
          kycChecks: checks,
          company: access.company,
          progress: progressFor(access.company, onboarding, checks),
        },
      };
    }

    if (isKyc && method === 'PATCH') {
      const access = moduleAccessOrThrow(ctx, companyId, 'write');
      const key = clientMatch[2]!;
      if (!KYC_TEMPLATE.some((item) => item.key === key)) {
        throw new ApiError(404, 'KYC_ITEM_NOT_FOUND', 'Élément KYC inconnu');
      }
      if (
        (payload.status === 'verified' || payload.status === 'not_applicable') &&
        WEIGHT[access.cabinetAccess] < WEIGHT.admin
      ) {
        throw new ApiError(403, 'MODULE_FORBIDDEN', 'Administration du cabinet requise');
      }
      if (!KYC_STATUSES.includes(payload.status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Statut KYC invalide');
      }
      if (!onboardingOf(s, companyId)) {
        const timestamp = ctx.now();
        ws.onboardings.push({
          company_id: companyId,
          status: 'in_progress',
          kyc_review_status: 'not_started',
          current_step: 2,
          sector: null,
          sector_notes: null,
          accounting_setup: {},
          selected_modules: [],
          assigned_accountant_id: null,
          activated_at: null,
          last_activity_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }
      if (!checksOf(s, companyId).length) {
        seedChecks(ws, companyId, {}, { uid: ctx.uid, now: ctx.now });
      }
      const check = checksOf(s, companyId).find((c) => c.key === key)!;
      check.status = payload.status;
      if (payload.documentRef !== undefined && payload.documentRef !== null) {
        check.document_ref = payload.documentRef;
      }
      if (payload.note !== undefined && payload.note !== null) check.note = payload.note;
      check.updated_at = ctx.now();

      const onboarding = onboardingOf(s, companyId)!;
      const checks = checksOf(s, companyId);
      const required = checks.filter((c) => c.required);
      const allOk = required.every((c) => ['received', 'verified', 'not_applicable'].includes(c.status));
      const anyCorrection = checks.some((c) => c.status === 'needs_correction');
      const previous = onboarding.kyc_review_status;
      if (anyCorrection) onboarding.kyc_review_status = 'in_progress';
      else if (allOk) onboarding.kyc_review_status = previous === 'approved' ? 'approved' : 'pending_review';
      else if (previous === 'approved' || previous === 'rejected' || previous === 'not_started') {
        onboarding.kyc_review_status = 'in_progress';
      }
      onboarding.last_activity_at = ctx.now();
      onboarding.updated_at = ctx.now();
      ctx.audit(companyId, 'cabinet.kyc.update', 'kyc_check', null, { key, status: payload.status });
      ctx.persist();
      return {
        handled: true,
        data: {
          onboarding: view(s, companyId),
          kycChecks: checks,
          progress: progressFor(access.company, view(s, companyId), checks),
        },
      };
    }

    if (method === 'GET') {
      const access = moduleAccessOrThrow(ctx, companyId, 'read');
      const onboarding = view(s, companyId);
      const checks = checksOf(s, companyId);
      const members = (s.members ?? []).filter((m: any) => m.company_id === companyId);
      const tasks = (s.tasks ?? [])
        .filter((t: any) => t.company_id === companyId)
        .sort((a: any, b: any) =>
          String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')),
        );
      const openTasks = tasks.filter((t: any) => !['done', 'cancelled'].includes(t.status));
      const checksData = computeChecks(ctx, companyId);
      const progress = progressFor(access.company, onboarding, checks);
      return {
        handled: true,
        data: {
          company: access.company,
          role: access.role,
          access,
          onboarding,
          kycChecks: checks,
          progress,
          sector: sectorDefinition(onboarding.sector) ?? null,
          checks: { ...checksData, missingDocuments: missingOf(checks).length },
          tasks: openTasks.slice(0, 50),
          recentActivity: clone(
            (s.audit ?? [])
              .filter((a: any) => a.company_id === companyId)
              .slice(-10)
              .reverse(),
          ),
          members: members.map((m: any) => ({ user_id: m.user_id, full_name: m.full_name, role: m.role })),
          moduleAvailability: MODULE_CATALOGUE.map((m) => ({
            code: m.code,
            order: m.order,
            availability: m.availability,
            appModule: m.appModule,
            access: access.modules[m.appModule] ?? 'none',
            allowed: WEIGHT[access.modules[m.appModule] ?? 'none'] > 0,
            selected: normaliseModules(onboarding.selected_modules).includes(m.code),
            routes: m.routes,
            labelKey: m.labelKey,
            shortKey: m.shortKey,
            descriptionKey: m.descriptionKey,
          })),
          catalogue: {
            sectors: SECTORS,
            kycTemplate: KYC_TEMPLATE,
            modules: MODULE_CATALOGUE,
            supportedCurrencies: SUPPORTED_CURRENCIES,
            accountingBases: ACCOUNTING_BASES,
          },
        },
      };
    }
  }

  /* -------------------------------------------------------------- drafts */
  if (path === '/cabinet/workspace/drafts' && method === 'GET') {
    return {
      handled: true,
      data: {
        drafts: clone(
          ws.drafts
            .filter((d) => d.owner_user_id === user.id)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        ),
      },
    };
  }

  if (path === '/cabinet/workspace/drafts' && method === 'POST') {
    const timestamp = ctx.now();
    const draft: DemoClientDraft = {
      id: ctx.uid(),
      owner_user_id: user.id,
      current_step: Number(payload.currentStep ?? 1),
      payload: payload.payload ?? {},
      created_at: timestamp,
      updated_at: timestamp,
    };
    ws.drafts.push(draft);
    ctx.persist();
    return { handled: true, data: { draft: clone(draft) } };
  }

  const draftMatch = /^\/cabinet\/workspace\/drafts\/([0-9a-f-]{36})(\/activate)?$/.exec(path);
  if (draftMatch) {
    const draft = ws.drafts.find(
      (d) => d.id === draftMatch[1] && d.owner_user_id === user.id,
    );
    if (!draft) throw new ApiError(404, 'DRAFT_NOT_FOUND', 'Brouillon introuvable');

    if (draftMatch[2] === '/activate' && method === 'POST') {
      const data = draft.payload ?? {};
      const companyData = data.company ?? {};
      const financial = data.financial ?? {};
      const name = String(companyData.name ?? '').trim();
      if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'Le nom de l’entreprise est obligatoire');
      const start = String(financial.financialYearStart ?? '');
      const end = String(financial.financialYearEnd ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Exercice comptable invalide');
      }
      const currency = String(financial.functionalCurrency ?? 'MUR').toUpperCase();
      if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Devise non prise en charge : ${currency}`);
      }
      if (
        companyData.brn &&
        (s.companies ?? []).some(
          (c: any) => (c.brn ?? '').toLowerCase() === String(companyData.brn).toLowerCase(),
        )
      ) {
        throw new ApiError(409, 'CONFLICT', 'Une société utilise déjà ce BRN');
      }
      if (!data.sector) throw new ApiError(400, 'VALIDATION_ERROR', 'Le secteur d’activité est obligatoire');
      const modules = normaliseModules(data.modules);
      if (modules.length === 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sélectionnez au moins un module');
      }
      const setup = normaliseAccountingSetup(data.accountingSetup);
      if (
        !setup.accountingBasis ||
        !setup.chartChoice ||
        !setup.openingBalanceChoice ||
        !setup.taxRegistration
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'La configuration comptable est incomplète');
      }

      const timestamp = ctx.now();
      const company = {
        id: ctx.uid(),
        name,
        brn: companyData.brn?.trim() || null,
        crn: companyData.crn?.trim() || null,
        client_code: companyData.clientCode?.trim() || null,
        dossier_manager_id: user.id,
        archived_at: null,
        vat_number: financial.vatNumber?.trim() || null,
        registered_address: companyData.address?.trim() || null,
        business_activity: data.sector,
        financial_year_start: start,
        financial_year_end: end,
        functional_currency: currency,
        presentation_currency: String(financial.presentationCurrency ?? currency).toUpperCase(),
        accounting_standard: financial.accountingStandard ?? 'IFRS',
        status: 'active' as const,
        locale: (user.locale as 'fr' | 'en') ?? 'fr',
        created_at: timestamp,
        trade_name: companyData.tradeName?.trim() || null,
        contact_name: companyData.contactName?.trim() || null,
        contact_email: companyData.contactEmail?.trim() || null,
        contact_phone: companyData.contactPhone?.trim() || null,
        legal_form: companyData.legalForm ?? null,
        incorporation_date: companyData.incorporationDate ?? null,
        business_description: companyData.businessDescription ?? null,
        country: companyData.country ?? null,
      };
      s.companies.push(company);
      s.members.push({
        id: ctx.uid(),
        company_id: company.id,
        user_id: user.id,
        role: 'owner',
        email: user.email,
        full_name: user.full_name,
      });
      s.periods.push({
        id: ctx.uid(),
        company_id: company.id,
        name: `Exercice ${start.slice(0, 4)}/${end.slice(0, 4)}`,
        start_date: start,
        end_date: end,
        status: 'open',
      });
      if (setup.chartChoice !== 'import_later') {
        for (const template of DEMO_SEED.accounts) {
          s.accounts.push({
            id: ctx.uid(),
            company_id: company.id,
            code: template.code,
            name: template.name,
            name_fr: template.name_fr ?? null,
            type: template.type,
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
          id: ctx.uid(),
          company_id: company.id,
          code: template.code,
          name: template.name,
          type: template.type,
          is_active: true,
        });
      }

      ws.onboardings.push({
        company_id: company.id,
        status: 'approved',
        kyc_review_status: 'in_progress',
        current_step: 6,
        sector: data.sector,
        sector_notes: data.sectorNotes ?? null,
        accounting_setup: setup as any,
        selected_modules: modules,
        assigned_accountant_id: user.id,
        activated_at: timestamp,
        last_activity_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      });
      seedChecks(ws, company.id, {}, { uid: ctx.uid, now: ctx.now });
      for (const check of data.kyc?.checks ?? []) {
        const row = checksOf(s, company.id).find((c) => c.key === check.key);
        if (!row || !KYC_TEMPLATE.some((item) => item.key === check.key)) continue;
        row.status = check.status;
        row.document_ref = check.documentRef ?? null;
        row.note = check.note ?? null;
      }
      const onboarding = onboardingOf(s, company.id)!;
      const checks = checksOf(s, company.id);
      const required = checks.filter((c) => c.required);
      onboarding.kyc_review_status = checks.some((c) => c.status === 'needs_correction')
        ? 'in_progress'
        : required.every((c) => ['received', 'verified', 'not_applicable'].includes(c.status))
          ? 'pending_review'
          : 'in_progress';

      ws.drafts = ws.drafts.filter((d) => d.id !== draft.id);
      ctx.audit(company.id, 'cabinet.onboarding.activate', 'company', company.id, {
        sector: data.sector,
        modules,
        draftId: draft.id,
      });
      ctx.persist();
      return {
        handled: true,
        data: {
          company,
          onboarding: view(s, company.id),
          kycChecks: checks,
          progress: progressFor(company, view(s, company.id), checks),
        },
      };
    }

    if (method === 'PATCH') {
      if (payload.currentStep !== undefined) draft.current_step = Number(payload.currentStep);
      if (payload.payload !== undefined) draft.payload = payload.payload;
      draft.updated_at = ctx.now();
      ctx.persist();
      return { handled: true, data: { draft: clone(draft) } };
    }

    if (method === 'DELETE') {
      ws.drafts = ws.drafts.filter((d) => d.id !== draft.id);
      ctx.persist();
      return { handled: true, data: { ok: true } };
    }
  }

  /* ----------------------------------------------------------- portfolio */
  if (path === '/cabinet/workspace' && method === 'GET') {
    const companies = (s.members ?? [])
      .filter((m: any) => m.user_id === user.id)
      .map((m: any) => {
        const company = (s.companies ?? []).find((c: any) => c.id === m.company_id);
        if (!company) return null;
        const modules = ctx.effectiveModules(company.id, user.id, m.role);
        if ((modules.cabinet ?? 'none') === 'none') return null;
        return { company, role: m.role, modules };
      })
      .filter((row: any): row is NonNullable<typeof row> => !!row)
      .sort((a: any, b: any) => a.company.name.localeCompare(b.company.name));

    const today = ctx.now().slice(0, 10);
    const openStatuses = ['todo', 'in_progress', 'blocked'];
    const allTasks = (s.tasks ?? []).filter((t: any) =>
      companies.some((row: any) => row.company.id === t.company_id),
    );

    const clients = companies.map(({ company, role, modules }: any) => {
      const onboarding = view(s, company.id);
      const checks = checksOf(s, company.id);
      const progress = progressFor(company, onboarding, checks);
      const tasks = allTasks.filter((t: any) => t.company_id === company.id);
      const open = tasks.filter((t: any) => openStatuses.includes(t.status));
      const tax = open.filter((t: any) => t.category === 'vat' || t.category === 'tax');
      const checkData = computeChecks(ctx, company.id);
      const members = (s.members ?? []).filter((m: any) => m.company_id === company.id);
      const accountant = members.find(
        (m: any) => m.user_id === onboarding.assigned_accountant_id,
      );
      const lastAudit = (s.audit ?? [])
        .filter((a: any) => a.company_id === company.id)
        .slice(-1)[0];
      return {
        id: company.id,
        name: company.name,
        trade_name: company.trade_name ?? null,
        brn: company.brn,
        client_code: company.client_code,
        status: company.status,
        cabinet_access: role === 'accountant' || role === 'viewer' || role === 'billing_clerk' || role === 'payroll_manager' ? 'read' : modules.cabinet ?? 'read',
        sector: onboarding.sector,
        sector_label_key: sectorDefinition(onboarding.sector)?.labelKey ?? null,
        onboarding_status: onboarding.status,
        kyc_review_status: onboarding.kyc_review_status,
        current_step: onboarding.current_step,
        assigned_accountant_id: onboarding.assigned_accountant_id,
        assigned_accountant_name: accountant?.full_name ?? null,
        financial_year_start: company.financial_year_start,
        financial_year_end: company.financial_year_end,
        functional_currency: company.functional_currency,
        accounting_standard: company.accounting_standard,
        open_tasks: open.length,
        tax_tasks: tax.length,
        missing_documents: missingOf(checks).length,
        progress_percent: progress.percent,
        completed_steps: progress.completedSteps,
        total_steps: progress.totalSteps,
        next_step: progress.nextStep,
        blocked_steps: progress.blockedSteps,
        accounting_exceptions: checkData.unpostedEntries + checkData.unbalancedEntries,
        last_activity_at: lastAudit?.created_at ?? null,
        members: members.map((m: any) => ({ id: m.user_id, full_name: m.full_name })),
        overdue: tax.some((t: any) => t.due_date && String(t.due_date) < today),
        assigned_role: role,
      };
    });

    const upcomingTax = allTasks
      .filter(
        (t: any) =>
          openStatuses.includes(t.status) && (t.category === 'vat' || t.category === 'tax'),
      )
      .sort((a: any, b: any) =>
        String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')),
      )
      .map((t: any) => ({
        title: t.title,
        due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
        company_name: (s.companies ?? []).find((c: any) => c.id === t.company_id)?.name ?? '',
        company_id: t.company_id,
      }));

    const unposted = clients.reduce((sum: number, c: any) => {
      const entries = (s.entries ?? []).filter(
        (e: any) => e.company_id === c.id && e.status === 'draft',
      );
      return sum + entries.length;
    }, 0);
    const unbalanced = clients.reduce((sum: number, c: any) => {
      return sum + computeChecks(ctx, c.id).unbalancedEntries;
    }, 0);
    const missingDocuments = clients.reduce((sum: number, c: any) => sum + c.missing_documents, 0);
    const accountants = Array.from(
      new Map(
        (s.members ?? [])
          .filter((m: any) => companies.some((row: any) => row.company.id === m.company_id))
          .map((m: any) => [m.user_id, m.full_name]),
      ).entries(),
    ).map(([id, full_name]) => ({ id, full_name }));

    return {
      handled: true,
      data: {
        cabinet: { id: 'demo-cabinet', name: 'Cabinet de démonstration COMPTAI' },
        user: { id: user.id, fullName: user.full_name, email: user.email },
        sectors: SECTORS.map((sector) => ({ key: sector.key, labelKey: sector.labelKey })),
        metrics: {
          totalClients: clients.length,
          activeClients: clients.filter((c: any) => c.status === 'active').length,
          onboardingInProgress: clients.filter((c: any) =>
            ['in_progress', 'pending_review'].includes(c.onboarding_status),
          ).length,
          pendingReviews: clients.filter(
            (c: any) =>
              c.kyc_review_status === 'pending_review' || c.onboarding_status === 'pending_review',
          ).length,
          missingDocuments,
          accountingExceptions: unposted + unbalanced,
          upcomingTaxTasks: upcomingTax.length,
          overdueTasks: allTasks.filter(
            (t: any) => openStatuses.includes(t.status) && t.due_date && String(t.due_date) < today,
          ).length,
        },
        metricDetails: {
          unpostedEntries: unposted,
          unbalancedEntries: unbalanced,
          pendingDocuments: (s.mission23?.proposals ?? []).filter(
            (proposal: any) =>
              proposal.status === 'PROPOSED' &&
              clients.some((client: any) => client.id === proposal.company_id),
          ).length,
          upcomingTaxTasks: upcomingTax.slice(0, 5),
        },
        clients,
        drafts: clone(
          ws.drafts
            .filter((d) => d.owner_user_id === user.id)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .map((d) => ({
              id: d.id,
              current_step: d.current_step,
              updated_at: d.updated_at,
              registered_name: d.payload?.company?.name ?? null,
              sector: d.payload?.sector ?? null,
            })),
        ),
        accountants,
        upcoming: upcomingTax.slice(0, 8),
        activity: clone((s.audit ?? []).slice(-12).reverse()),
      },
    };
  }

  // Unknown /cabinet/workspace sub-route: explicit rather than silently empty.
  void query;
  throw new ApiError(404, 'NOT_FOUND', 'Route de démonstration inconnue');
}

export type { OnboardingStepKey };
