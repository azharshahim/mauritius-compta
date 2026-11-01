/**
 * Mission 44 — Accountant Workspace API.
 *
 * Cabinet → Clients → Create New Client → Guided Onboarding → Client Workspace
 * → Accounting Operations → Review & Reporting.
 *
 * Boundaries respected by this module:
 *  - `companies` stays the single client master file (no second client base);
 *  - no accounting engine, no VAT computation, no payroll and no reconciliation
 *    logic is reimplemented: the workspace only *reads* what those modules
 *    already store and links to their screens;
 *  - authorisation is enforced server-side on every call: cabinet `read` for the
 *    portfolio, cabinet `write` to configure a file, cabinet `admin` to verify
 *    KYC items or to activate a dossier;
 *  - no identity document is uploaded or stored: the KYC section is a checklist
 *    with references only (see docs/cabinet-onboarding.md).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { createClientFile } from '../../lib/client-file.js';
import {
  ACCESS_WEIGHT,
  effectiveAccess,
  effectiveModules,
  requireModuleAccess,
} from '../../lib/permissions.js';
import type { CompanyRole, CompanyRow } from '../../types.js';
import {
  ACCOUNTING_BASES,
  CHART_CHOICES,
  KYC_REVIEW_STATUSES,
  KYC_STATUSES,
  KYC_TEMPLATE,
  LEGAL_FORMS,
  MODULE_CATALOGUE,
  MODULE_CODES,
  OPENING_BALANCE_CHOICES,
  SECTORS,
  SECTOR_KEYS,
  SUPPORTED_CURRENCIES,
  TAX_REGISTRATION_CHOICES,
  isModuleCode,
  normaliseAccountingSetup,
  sectorDefinition,
} from './catalogue.js';
import {
  computeOnboardingProgress,
  defaultKycChecks,
  missingKycDocuments,
  normaliseModules,
  type OnboardingStepKey,
} from './progress.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const optionalText = (max: number) => z.string().max(max).nullish();
const optionalEmail = z.string().email().max(200).nullish().or(z.literal('').nullish());

const moduleList = z.array(z.enum(MODULE_CODES as unknown as [string, ...string[]])).max(8);
const sectorEnum = z.enum(SECTOR_KEYS as unknown as [string, ...string[]]);
const legalFormEnum = z.enum(LEGAL_FORMS as unknown as [string, ...string[]]);

const accountingSetupBody = z.object({
  accountingBasis: z.enum(ACCOUNTING_BASES as unknown as [string, ...string[]]).nullish(),
  chartChoice: z.enum(CHART_CHOICES as unknown as [string, ...string[]]).nullish(),
  openingBalanceChoice: z.enum(OPENING_BALANCE_CHOICES as unknown as [string, ...string[]]).nullish(),
  taxRegistration: z.enum(TAX_REGISTRATION_CHOICES as unknown as [string, ...string[]]).nullish(),
  bankAccountsReviewed: z.boolean().optional(),
  vatRegistered: z.boolean().optional(),
  notes: optionalText(2000),
});

const companyDraft = z
  .object({
    name: optionalText(200),
    tradeName: optionalText(200),
    brn: optionalText(40),
    crn: optionalText(40),
    legalForm: legalFormEnum.nullish(),
    incorporationDate: isoDate.nullish(),
    address: optionalText(500),
    country: optionalText(120),
    contactName: optionalText(200),
    contactEmail: optionalEmail,
    contactPhone: optionalText(40),
    businessDescription: optionalText(2000),
    clientCode: optionalText(24),
  })
  .partial();

const financialDraft = z
  .object({
    financialYearStart: isoDate.nullish(),
    financialYearEnd: isoDate.nullish(),
    functionalCurrency: z.string().length(3).nullish(),
    presentationCurrency: z.string().length(3).nullish(),
    accountingStandard: optionalText(40),
    vatNumber: optionalText(40),
  })
  .partial();

const kycDraft = z
  .object({
    reviewStatus: z.enum(KYC_REVIEW_STATUSES as unknown as [string, ...string[]]).optional(),
    checks: z
      .array(
        z.object({
          key: z.string().min(1).max(80),
          status: z.enum(KYC_STATUSES as unknown as [string, ...string[]]),
          documentRef: optionalText(200),
          note: optionalText(500),
        }),
      )
      .max(200)
      .optional(),
  })
  .partial();

const draftPayload = z
  .object({
    company: companyDraft.optional(),
    financial: financialDraft.optional(),
    kyc: kycDraft.optional(),
    sector: sectorEnum.nullish(),
    sectorNotes: optionalText(2000),
    accountingSetup: accountingSetupBody.partial().nullish(),
    modules: moduleList.optional(),
  })
  .partial();

const draftBody = z.object({
  currentStep: z.number().int().min(1).max(6).optional(),
  payload: draftPayload.optional(),
});

const onboardingPatch = z
  .object({
    currentStep: z.number().int().min(1).max(6).optional(),
    sector: sectorEnum.nullish(),
    sectorNotes: optionalText(2000),
    selectedModules: moduleList.optional(),
    accountingSetup: accountingSetupBody.partial().nullish(),
    kycReviewStatus: z.enum(KYC_REVIEW_STATUSES as unknown as [string, ...string[]]).optional(),
    status: z.enum(['in_progress', 'pending_review', 'approved', 'rejected']).optional(),
    assignedAccountantId: z.string().uuid().nullish(),
    tradeName: optionalText(200),
    legalForm: legalFormEnum.nullish(),
    incorporationDate: isoDate.nullish(),
    contactName: optionalText(200),
    contactEmail: optionalEmail,
    contactPhone: optionalText(40),
    businessDescription: optionalText(2000),
    country: optionalText(120),
    registeredAddress: optionalText(500),
  })
  .partial();

const kycUpdateBody = z.object({
  status: z.enum(KYC_STATUSES as unknown as [string, ...string[]]),
  documentRef: optionalText(200),
  note: optionalText(500),
});

type CompanyWithRole = CompanyRow & { role: CompanyRole };

function placeholders(count: number, offset = 1): string {
  return Array.from({ length: count }, (_, i) => `$${i + offset}`).join(',');
}

/** Companies the user can open through the cabinet module. */
async function cabinetCompanies(
  db: Db,
  userId: string,
): Promise<{ companies: CompanyWithRole[]; access: Map<string, 'none' | 'read' | 'write' | 'admin'> }> {
  const res = await db.query<CompanyWithRole>(
    `SELECT c.*, m.role
       FROM companies c
       JOIN company_members m ON m.company_id = c.id
      WHERE m.user_id = $1
      ORDER BY c.name ASC`,
    [userId],
  );
  const access = new Map<string, 'none' | 'read' | 'write' | 'admin'>();
  const companies: CompanyWithRole[] = [];
  for (const row of res.rows) {
    const level = await effectiveAccess(db, row.id, userId, row.role, 'cabinet');
    if (ACCESS_WEIGHT[level] > 0) {
      access.set(row.id, level);
      companies.push(row);
    }
  }
  return { companies, access };
}

function onboardingView(row: any, companyId: string) {
  if (!row) {
    return {
      company_id: companyId,
      status: 'not_started' as const,
      kyc_review_status: 'not_started' as const,
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
}

/** Progress engine input built from a company row plus its onboarding state. */
function progressFor(company: CompanyRow, onboarding: any, kycChecks: any[]) {
  return computeOnboardingProgress({
    company,
    onboarding: {
      sector: onboarding.sector ?? null,
      selected_modules: onboarding.selected_modules ?? [],
      accounting_setup: onboarding.accounting_setup ?? {},
      kyc_review_status: onboarding.kyc_review_status ?? 'not_started',
      status: onboarding.status ?? 'not_started',
      activated_at: onboarding.activated_at ?? null,
    },
    kycChecks: kycChecks.map((c) => ({ key: c.key, status: c.status, required: c.required })),
  });
}

export function cabinetOnboardingRoutes(app: FastifyInstance, db: Db) {
  /* ------------------------------------------------------------------ common */

  async function requireCabinetUser(req: FastifyRequest, level: 'read' | 'write' | 'admin', companyId: string) {
    const user = req.user!;
    const access = await requireModuleAccess(db, user.id, companyId, 'cabinet', level);
    return { user, access };
  }

  async function loadCompany(companyId: string): Promise<CompanyRow> {
    const res = await db.query<CompanyRow>('SELECT * FROM companies WHERE id = $1', [companyId]);
    const company = res.rows[0];
    if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
    return company;
  }

  async function onboardingRow(companyId: string, tx: Db = db) {
    const res = await tx.query('SELECT * FROM client_onboarding WHERE company_id = $1', [companyId]);
    return res.rows[0] ?? null;
  }

  async function kycChecksOf(companyId: string, tx: Db = db) {
    const res = await tx.query(
      `SELECT id, company_id, key, category, required, status, document_ref, note, updated_at
         FROM client_kyc_checks WHERE company_id = $1 ORDER BY category, key`,
      [companyId],
    );
    return res.rows;
  }

  /**
   * Creates the checklist rows for a company the first time it is configured.
   * Idempotent: `ON CONFLICT DO NOTHING` keeps an existing follow-up intact.
   */
  async function ensureKycChecks(tx: Db, companyId: string) {
    for (const item of defaultKycChecks()) {
      await tx.query(
        `INSERT INTO client_kyc_checks (company_id, key, category, required, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, key) DO NOTHING`,
        [companyId, item.key, item.category, item.required, item.status],
      );
    }
  }

  /** The cabinet of the user, used for the workspace header only. */
  async function cabinetOfUser(userId: string, companies: CompanyRow[]) {
    if (companies.length > 0) {
      const res = await db.query<{ id: string; name: string }>(
        `SELECT cb.id, cb.name FROM cabinets cb WHERE cb.id = (
           SELECT cabinet_id FROM companies WHERE id = $1 AND cabinet_id IS NOT NULL
         )`,
        [companies[0]!.id],
      );
      if (res.rows[0]) return res.rows[0];
    }
    const own = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM cabinets WHERE owner_user_id = $1 ORDER BY created_at LIMIT 1',
      [userId],
    );
    return own.rows[0] ?? null;
  }

  /* ------------------------------------------------------ cabinet workspace */

  app.get('/cabinet/workspace', async (req) => {
    const user = req.user!;
    const { companies, access } = await cabinetCompanies(db, user.id);
    const ids = companies.map((c) => c.id);
    const cabinet = await cabinetOfUser(user.id, companies);

    const empty = {
      cabinet,
      user: { id: user.id, fullName: user.full_name, email: user.email },
      sectors: SECTORS.map((s) => ({ key: s.key, labelKey: s.labelKey })),
      metrics: {
        totalClients: 0,
        activeClients: 0,
        onboardingInProgress: 0,
        pendingReviews: 0,
        missingDocuments: 0,
        accountingExceptions: 0,
        upcomingTaxTasks: 0,
        overdueTasks: 0,
      },
      metricDetails: {
        unpostedEntries: 0,
        unbalancedEntries: 0,
        pendingDocuments: 0,
        upcomingTaxTasks: [] as { title: string; due_date: string | null; company_name: string }[],
      },
      clients: [],
      drafts: [] as any[],
      upcoming: [],
      activity: [],
      accountants: [] as { id: string; full_name: string }[],
    };

    const drafts = await db.query(
      `SELECT id, current_step, payload, created_at, updated_at
         FROM cabinet_client_drafts
        WHERE owner_user_id = $1
        ORDER BY updated_at DESC
        LIMIT 20`,
      [user.id],
    );
    empty.drafts = drafts.rows.map((d: any) => ({
      id: d.id,
      current_step: d.current_step,
      updated_at: d.updated_at,
      registered_name: d.payload?.company?.name ?? null,
      sector: d.payload?.sector ?? null,
    }));
    if (ids.length === 0) return empty;

    const ph = placeholders(ids.length, 1);
    const params = [...ids] as unknown[];

    const [
      onboardingRes,
      kycRes,
      draftEntriesRes,
      unbalancedRes,
      taskRes,
      activityRes,
      membersRes,
      pendingDocsRes,
    ] = await Promise.all([
        db.query('SELECT * FROM client_onboarding WHERE company_id IN (' + ph + ')', params),
        db.query(
          `SELECT company_id, key, required, status FROM client_kyc_checks
            WHERE company_id IN (${ph})`,
          params,
        ),
        db.query<{ company_id: string; n: number }>(
          `SELECT company_id, count(*)::int AS n FROM journal_entries
            WHERE company_id IN (${ph}) AND status = 'draft'
            GROUP BY company_id`,
          params,
        ),
        db.query<{ company_id: string; n: number }>(
          `SELECT company_id, count(*)::int AS n FROM (
             SELECT e.company_id, e.id
               FROM journal_entries e
               JOIN journal_lines l ON l.entry_id = e.id
              WHERE e.status = 'posted' AND e.company_id IN (${ph})
              GROUP BY e.company_id, e.id
             HAVING sum(l.debit) <> sum(l.credit)
           ) t GROUP BY company_id`,
          params,
        ),
        db.query(
          `SELECT t.id, t.company_id, t.title, t.category, t.status, t.priority, t.due_date,
                  u.full_name AS assignee_name
             FROM cabinet_tasks t
             LEFT JOIN app_users u ON u.id = t.assigned_to
            WHERE t.company_id IN (${ph})`,
          params,
        ),
        db.query(
          `SELECT a.company_id, max(a.created_at) AS last_activity
             FROM audit_log a WHERE a.company_id IN (${ph}) GROUP BY a.company_id`,
          params,
        ),
        db.query<{ company_id: string; user_id: string; full_name: string }>(
          `SELECT m.company_id, u.id AS user_id, u.full_name
             FROM company_members m JOIN app_users u ON u.id = m.user_id
            WHERE m.company_id IN (${ph})`,
          params,
        ),
        db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM document_proposals
            WHERE company_id IN (${ph}) AND status = 'PROPOSED'`,
          params,
        ),
      ]);

    const onboardingByCompany = new Map<string, any>(onboardingRes.rows.map((r: any) => [r.company_id, r]));
    const kycByCompany = new Map<string, any[]>();
    for (const row of kycRes.rows as any[]) {
      const list = kycByCompany.get(row.company_id) ?? [];
      list.push(row);
      kycByCompany.set(row.company_id, list);
    }
    const draftsByCompany = new Map<string, number>(
      draftEntriesRes.rows.map((r) => [r.company_id, Number(r.n)]),
    );
    const unbalancedByCompany = new Map<string, number>(
      unbalancedRes.rows.map((r) => [r.company_id, Number(r.n)]),
    );
    const lastActivity = new Map<string, string>(
      activityRes.rows.map((r: any) => [r.company_id, r.last_activity]),
    );
    const memberNames = new Map<string, string>();
    const companyMembers = new Map<string, { id: string; full_name: string }[]>();
    for (const row of membersRes.rows) {
      memberNames.set(row.user_id, row.full_name);
      const list = companyMembers.get(row.company_id) ?? [];
      list.push({ id: row.user_id, full_name: row.full_name });
      companyMembers.set(row.company_id, list);
    }

    const today = new Date().toISOString().slice(0, 10);
    const openStatuses = new Set(['todo', 'in_progress', 'blocked']);
    const taskStats = new Map<string, { open: number; tax: number }>();
    let overdueTasks = 0;
    const upcomingTax: { title: string; due_date: string | null; company_name: string; company_id: string }[] = [];
    for (const t of taskRes.rows as any[]) {
      if (!openStatuses.has(t.status)) continue;
      const stat = taskStats.get(t.company_id) ?? { open: 0, tax: 0 };
      stat.open += 1;
      const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
      if (due && due < today) overdueTasks += 1;
      if (t.category === 'vat' || t.category === 'tax') {
        stat.tax += 1;
        upcomingTax.push({
          title: t.title,
          due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
          company_name: companies.find((c) => c.id === t.company_id)?.name ?? '',
          company_id: t.company_id,
        });
      }
      taskStats.set(t.company_id, stat);
    }
    upcomingTax.sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')));

    const clients = companies.map((company) => {
      const onboarding = onboardingView(onboardingByCompany.get(company.id), company.id);
      const checks = kycByCompany.get(company.id) ?? [];
      const progress = progressFor(company, onboarding, checks);
      const stat = taskStats.get(company.id) ?? { open: 0, tax: 0 };
      const unposted = draftsByCompany.get(company.id) ?? 0;
      const unbalanced = unbalancedByCompany.get(company.id) ?? 0;
      return {
        id: company.id,
        name: company.name,
        trade_name: (company as any).trade_name ?? null,
        brn: company.brn,
        client_code: company.client_code,
        status: company.status,
        cabinet_access: access.get(company.id) ?? 'read',
        sector: onboarding.sector,
        sector_label_key: sectorDefinition(onboarding.sector)?.labelKey ?? null,
        onboarding_status: onboarding.status,
        kyc_review_status: onboarding.kyc_review_status,
        current_step: onboarding.current_step,
        assigned_accountant_id: onboarding.assigned_accountant_id,
        assigned_accountant_name: onboarding.assigned_accountant_id
          ? memberNames.get(onboarding.assigned_accountant_id) ?? null
          : null,
        financial_year_start: company.financial_year_start,
        financial_year_end: company.financial_year_end,
        functional_currency: company.functional_currency,
        accounting_standard: (company as any).accounting_standard ?? null,
        open_tasks: stat.open,
        tax_tasks: stat.tax,
        missing_documents: progress.missingDocuments.length,
        progress_percent: progress.percent,
        completed_steps: progress.completedSteps,
        total_steps: progress.totalSteps,
        next_step: progress.nextStep,
        blocked_steps: progress.blockedSteps,
        accounting_exceptions: unposted + unbalanced,
        last_activity_at: lastActivity.get(company.id) ?? null,
        members: companyMembers.get(company.id) ?? [],
        overdue:
          upcomingTax.some(
            (t) => t.company_id === company.id && t.due_date !== null && t.due_date < today,
          ) && stat.tax > 0,
      };
    });

    const totalMissing = [...kycByCompany.values()]
      .flat()
      .filter((c) => c.required && ['not_started', 'requested', 'missing'].includes(c.status)).length;
    const unpostedTotal = [...draftsByCompany.values()].reduce((a, b) => a + b, 0);
    const unbalancedTotal = [...unbalancedByCompany.values()].reduce((a, b) => a + b, 0);

    return {
      ...empty,
      metrics: {
        totalClients: clients.length,
        activeClients: clients.filter((c) => c.status === 'active').length,
        onboardingInProgress: clients.filter(
          (c) => c.onboarding_status === 'in_progress' || c.onboarding_status === 'pending_review',
        ).length,
        pendingReviews: clients.filter(
          (c) => c.kyc_review_status === 'pending_review' || c.onboarding_status === 'pending_review',
        ).length,
        missingDocuments: totalMissing,
        accountingExceptions: unpostedTotal + unbalancedTotal,
        upcomingTaxTasks: upcomingTax.length,
        overdueTasks,
      },
      metricDetails: {
        unpostedEntries: unpostedTotal,
        unbalancedEntries: unbalancedTotal,
        pendingDocuments: Number(pendingDocsRes.rows[0]?.n ?? 0),
        upcomingTaxTasks: upcomingTax.slice(0, 5),
      },
      clients,
      accountants: (() => {
        const map = new Map<string, string>();
        for (const list of companyMembers.values()) {
          for (const m of list) map.set(m.id, m.full_name);
        }
        return [...map.entries()].map(([id, full_name]) => ({ id, full_name }));
      })(),
    };
  });

  /* ------------------------------------------------------ client workspace */

  app.get('/cabinet/workspace/clients/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const { user, access: ctx } = await requireCabinetUser(req, 'read', companyId);
    const access = ctx;
    const company = await loadCompany(companyId);
    const onboarding = onboardingView(await onboardingRow(companyId), companyId);
    const kycChecks = await kycChecksOf(companyId);
    const modulesAccess = await effectiveModules(db, companyId, user.id, ctx.role);
    const progress = progressFor(company, onboarding, kycChecks);

    const [entriesRes, unbalancedRes, openingsRes, bankRes, proposalsRes, accountsRes, tasksRes, activityRes, memberRes] =
      await Promise.all([
        db.query<{ drafts: number; posted: number }>(
          `SELECT count(*) FILTER (WHERE status = 'draft')::int AS drafts,
                  count(*) FILTER (WHERE status = 'posted')::int AS posted
             FROM journal_entries WHERE company_id = $1`,
          [companyId],
        ),
        db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM (
             SELECT e.id FROM journal_entries e
               JOIN journal_lines l ON l.entry_id = e.id
              WHERE e.company_id = $1 AND e.status = 'posted'
              GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)
           ) t`,
          [companyId],
        ),
        db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM opening_balance_batches WHERE company_id = $1',
          [companyId],
        ),
        db.query<{ accounts: number; unreconciled: number }>(
          `SELECT
             (SELECT count(*)::int FROM bank_accounts WHERE company_id = $1 AND is_active) AS accounts,
             (SELECT count(*)::int FROM bank_transactions t
               WHERE t.company_id = $1
                 AND NOT EXISTS (
                   SELECT 1 FROM bank_matches m
                    WHERE m.transaction_id = t.id AND m.status = 'confirmed'
                 )) AS unreconciled`,
          [companyId],
        ),
        db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM document_proposals
            WHERE company_id = $1 AND status = 'PROPOSED'`,
          [companyId],
        ),
        db.query<{ n: number }>('SELECT count(*)::int AS n FROM accounts WHERE company_id = $1', [
          companyId,
        ]),
        db.query(
          `SELECT t.id, t.title, t.category, t.status, t.priority, t.due_date,
                  u.full_name AS assignee_name
             FROM cabinet_tasks t LEFT JOIN app_users u ON u.id = t.assigned_to
            WHERE t.company_id = $1
            ORDER BY (t.due_date IS NULL), t.due_date ASC
            LIMIT 50`,
          [companyId],
        ),
        db.query(
          `SELECT a.id, a.action, a.entity_type, a.created_at, u.full_name AS user_name
             FROM audit_log a LEFT JOIN app_users u ON u.id = a.user_id
            WHERE a.company_id = $1
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 10`,
          [companyId],
        ),
        db.query<{ user_id: string; full_name: string; role: CompanyRole }>(
          `SELECT m.user_id, u.full_name, m.role
             FROM company_members m JOIN app_users u ON u.id = m.user_id
            WHERE m.company_id = $1 ORDER BY u.full_name`,
          [companyId],
        ),
      ]);

    const trial = await db.query<{ debit: string | null; credit: string | null }>(
      `SELECT sum(l.debit) AS debit, sum(l.credit) AS credit
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.company_id = $1 AND e.status = 'posted'`,
      [companyId],
    );
    const debit = Number(trial.rows[0]?.debit ?? 0);
    const credit = Number(trial.rows[0]?.credit ?? 0);
    const openTasks = (tasksRes.rows as any[]).filter(
      (t) => !['done', 'cancelled'].includes(t.status),
    );

    return {
      company,
      role: ctx.role,
      access: modulesAccess,
      onboarding,
      kycChecks,
      progress,
      sector: sectorDefinition(onboarding.sector) ?? null,
      checks: {
        unpostedEntries: Number(entriesRes.rows[0]?.drafts ?? 0),
        postedEntries: Number(entriesRes.rows[0]?.posted ?? 0),
        unbalancedEntries: Number(unbalancedRes.rows[0]?.n ?? 0),
        trialBalance: {
          debit,
          credit,
          balanced: Math.abs(debit - credit) < 0.00005,
        },
        openingBalanceBatches: Number(openingsRes.rows[0]?.n ?? 0),
        bankAccounts: Number(bankRes.rows[0]?.accounts ?? 0),
        unreconciledTransactions: Number(bankRes.rows[0]?.unreconciled ?? 0),
        pendingProposals: Number(bankRes.rows[0]?.unreconciled ?? 0) + Number(proposalsRes.rows[0]?.n ?? 0),
        accounts: Number(accountsRes.rows[0]?.n ?? 0),
        missingDocuments: progress.missingDocuments.length,
      },
      tasks: openTasks,
      recentActivity: activityRes.rows,
      members: memberRes.rows,
      moduleAvailability: MODULE_CATALOGUE.map((m) => ({
        code: m.code,
        order: m.order,
        availability: m.availability,
        appModule: m.appModule,
        access: modulesAccess[m.appModule],
        allowed: ACCESS_WEIGHT[modulesAccess[m.appModule]] > 0,
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
    };
  });

  /* -------------------------------------------------- onboarding update */

  app.patch('/cabinet/workspace/clients/:companyId/onboarding', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const user = req.user!;
    const ctx = await requireModuleAccess(db, user.id, companyId, 'cabinet', 'read');
    const access = ctx.access;
    if (ACCESS_WEIGHT[access] < ACCESS_WEIGHT.write) {
      throw forbidden('Consultation seule : la configuration du dossier requiert le droit d’écriture');
    }
    const body = parse(onboardingPatch, req.body);
    const company = await loadCompany(companyId);
    const existing = await onboardingRow(companyId);

    // Approval of the KYC review, activation and accountant assignment are
    // administration acts: they require cabinet `admin` on this dossier.
    const needsAdmin =
      body.kycReviewStatus === 'approved' ||
      body.kycReviewStatus === 'rejected' ||
      body.status === 'approved' ||
      body.status === 'rejected' ||
      body.assignedAccountantId !== undefined;
    if (needsAdmin && ACCESS_WEIGHT[access] < ACCESS_WEIGHT.admin) {
      throw forbidden('Administration du cabinet requise pour cette opération');
    }
    if (body.assignedAccountantId) {
      const member = await db.query(
        'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
        [companyId, body.assignedAccountantId],
      );
      if (member.rowCount === 0) {
        throw badRequest('VALIDATION_ERROR', 'The assigned accountant must be a member of this dossier');
      }
    }

    const currentSetup = normaliseAccountingSetup((existing as any)?.accounting_setup);
    const mergedSetup = body.accountingSetup
      ? normaliseAccountingSetup({ ...currentSetup, ...body.accountingSetup })
      : currentSetup;
    const mergedModules =
      body.selectedModules !== undefined
        ? normaliseModules(body.selectedModules)
        : normaliseModules((existing as any)?.selected_modules ?? []);
    const mergedSector = body.sector !== undefined ? body.sector : (existing as any)?.sector ?? null;

    // Controlled activation: the file must be configured. KYC documents may
    // still be pending — they remain follow-up tasks and are never presented as
    // a legal validation.
    if (body.status === 'approved') {
      const incomplete: string[] = [];
      if (!mergedSector) incomplete.push('sector');
      if (mergedModules.length === 0) incomplete.push('modules');
      if (
        !mergedSetup.accountingBasis ||
        !mergedSetup.chartChoice ||
        !mergedSetup.openingBalanceChoice ||
        !mergedSetup.taxRegistration
      ) {
        incomplete.push('accounting_setup');
      }
      if (incomplete.length > 0) {
        throw conflict('ONBOARDING_INCOMPLETE', 'The client file is not ready to be activated', incomplete);
      }
    }

    await db.transaction(async (tx) => {
      await ensureKycChecks(tx, companyId);
      await tx.query(
        `INSERT INTO client_onboarding
           (company_id, status, kyc_review_status, current_step, sector, sector_notes,
            accounting_setup, selected_modules, assigned_accountant_id, activated_at, activated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
         ON CONFLICT (company_id) DO UPDATE SET
           status = EXCLUDED.status,
           kyc_review_status = EXCLUDED.kyc_review_status,
           current_step = EXCLUDED.current_step,
           sector = COALESCE(EXCLUDED.sector, client_onboarding.sector),
           sector_notes = COALESCE(EXCLUDED.sector_notes, client_onboarding.sector_notes),
           accounting_setup = CASE
             WHEN EXCLUDED.accounting_setup = '{}'::jsonb THEN client_onboarding.accounting_setup
             ELSE EXCLUDED.accounting_setup END,
           selected_modules = CASE
             WHEN jsonb_array_length(EXCLUDED.selected_modules) > 0 THEN EXCLUDED.selected_modules
             ELSE client_onboarding.selected_modules END,
           assigned_accountant_id = EXCLUDED.assigned_accountant_id,
           activated_at = COALESCE(EXCLUDED.activated_at, client_onboarding.activated_at),
           activated_by = COALESCE(EXCLUDED.activated_by, client_onboarding.activated_by),
           last_activity_at = now(),
           updated_at = now()`,
        [
          companyId,
          body.status ?? (existing as any)?.status ?? 'in_progress',
          body.kycReviewStatus ?? (existing as any)?.kyc_review_status ?? 'not_started',
          body.currentStep ?? (existing as any)?.current_step ?? 1,
          mergedSector,
          body.sectorNotes ?? null,
          JSON.stringify(mergedSetup),
          JSON.stringify(mergedModules),
          body.assignedAccountantId !== undefined
            ? body.assignedAccountantId
            : (existing as any)?.assigned_accountant_id ?? null,
          body.status === 'approved' ? new Date().toISOString() : null,
          body.status === 'approved' ? user.id : null,
        ],
      );
      // Descriptive fields of the client file live on `companies`: one master
      // file, no duplicate client record.
      const companyPatch: Record<string, string | null> = {};
      if (body.tradeName !== undefined) companyPatch.trade_name = body.tradeName;
      if (body.legalForm !== undefined) companyPatch.legal_form = body.legalForm;
      if (body.incorporationDate !== undefined) companyPatch.incorporation_date = body.incorporationDate;
      if (body.contactName !== undefined) companyPatch.contact_name = body.contactName;
      if (body.contactEmail !== undefined) companyPatch.contact_email = body.contactEmail || null;
      if (body.contactPhone !== undefined) companyPatch.contact_phone = body.contactPhone;
      if (body.businessDescription !== undefined) companyPatch.business_description = body.businessDescription;
      if (body.country !== undefined) companyPatch.country = body.country;
      if (body.registeredAddress !== undefined) companyPatch.registered_address = body.registeredAddress;
      const keys = Object.keys(companyPatch);
      if (keys.length > 0) {
        await tx.query(
          `UPDATE companies SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now()
            WHERE id = $1`,
          [companyId, ...keys.map((k) => companyPatch[k] ?? null)],
        );
      }
      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: body.status === 'approved' ? 'cabinet.onboarding.activate' : 'cabinet.onboarding.update',
        entityType: 'company',
        entityId: companyId,
        details: {
          sector: mergedSector,
          modules: mergedModules,
          status: body.status ?? null,
          kycReviewStatus: body.kycReviewStatus ?? null,
        },
        ip: clientIp(req),
      });
    });

    const onboarding = onboardingView(await onboardingRow(companyId), companyId);
    const kycChecks = await kycChecksOf(companyId);
    const updatedCompany = await loadCompany(companyId);
    return {
      onboarding,
      kycChecks,
      company: updatedCompany,
      progress: progressFor(updatedCompany, onboarding, kycChecks),
    };
  });

  /* ------------------------------------------------------------- KYC item */

  app.patch('/cabinet/workspace/clients/:companyId/onboarding/kyc/:key', async (req) => {
    const { companyId, key } = req.params as { companyId: string; key: string };
    const user = req.user!;
    const ctx = await requireModuleAccess(db, user.id, companyId, 'cabinet', 'write');
    const access = ctx.access;
    const body = parse(kycUpdateBody, req.body);
    if (!KYC_TEMPLATE.some((item) => item.key === key)) {
      throw notFound('KYC_ITEM_NOT_FOUND', 'Unknown KYC checklist item');
    }
    // Marking a document as verified (or as not applicable) is a review act.
    if ((body.status === 'verified' || body.status === 'not_applicable') && ACCESS_WEIGHT[access] < ACCESS_WEIGHT.admin) {
      throw forbidden('Administration du cabinet requise pour vérifier un document');
    }

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO client_onboarding (company_id) VALUES ($1)
         ON CONFLICT (company_id) DO NOTHING`,
        [companyId],
      );
      await ensureKycChecks(tx, companyId);
      await tx.query(
        `UPDATE client_kyc_checks
            SET status = $3, document_ref = COALESCE($4, document_ref),
                note = COALESCE($5, note), updated_by = $6, updated_at = now()
          WHERE company_id = $1 AND key = $2`,
        [companyId, key, body.status, body.documentRef ?? null, body.note ?? null, user.id],
      );

      // Deterministic review status derived from the checklist itself. A new
      // correction invalidates a previous approval on purpose.
      const res = await tx.query<{ required: boolean; status: string }>(
        'SELECT required, status FROM client_kyc_checks WHERE company_id = $1',
        [companyId],
      );
      const required = res.rows.filter((r) => r.required);
      const allOk = required.every((r) => ['received', 'verified', 'not_applicable'].includes(r.status));
      const anyCorrection = res.rows.some((r) => r.status === 'needs_correction');
      const current = await tx.query<{ kyc_review_status: string }>(
        'SELECT kyc_review_status FROM client_onboarding WHERE company_id = $1',
        [companyId],
      );
      const previous = current.rows[0]?.kyc_review_status ?? 'not_started';
      let next = previous;
      if (anyCorrection) next = 'in_progress';
      else if (allOk) next = previous === 'approved' ? 'approved' : 'pending_review';
      else if (previous === 'approved') next = 'in_progress';
      else if (previous === 'rejected' || previous === 'not_started') next = 'in_progress';
      await tx.query(
        `UPDATE client_onboarding
            SET kyc_review_status = $2, last_activity_at = now(), updated_at = now()
          WHERE company_id = $1`,
        [companyId, next],
      );
      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'cabinet.kyc.update',
        entityType: 'kyc_check',
        entityId: null,
        details: { key, status: body.status, reviewStatus: next },
        ip: clientIp(req),
      });
    });

    const onboarding = onboardingView(await onboardingRow(companyId), companyId);
    const kycChecks = await kycChecksOf(companyId);
    const company = await loadCompany(companyId);
    return {
      onboarding,
      kycChecks,
      progress: progressFor(company, onboarding, kycChecks),
    };
  });

  /* ---------------------------------------------------------------- drafts */

  app.get('/cabinet/workspace/drafts', async (req) => {
    const user = req.user!;
    const res = await db.query(
      `SELECT id, current_step, payload, created_at, updated_at
         FROM cabinet_client_drafts WHERE owner_user_id = $1
        ORDER BY updated_at DESC LIMIT 50`,
      [user.id],
    );
    return { drafts: res.rows };
  });

  app.post('/cabinet/workspace/drafts', async (req, reply) => {
    const user = req.user!;
    const body = parse(draftBody, req.body ?? {});
    const created = await db.query(
      `INSERT INTO cabinet_client_drafts (owner_user_id, current_step, payload)
       VALUES ($1, $2, $3::jsonb) RETURNING *`,
      [user.id, body.currentStep ?? 1, JSON.stringify(body.payload ?? {})],
    );
    return reply.code(201).send({ draft: created.rows[0] });
  });

  app.patch('/cabinet/workspace/drafts/:draftId', async (req) => {
    const user = req.user!;
    const { draftId } = req.params as { draftId: string };
    const body = parse(draftBody, req.body ?? {});
    const owned = await db.query(
      'SELECT id FROM cabinet_client_drafts WHERE id = $1 AND owner_user_id = $2',
      [draftId, user.id],
    );
    if (owned.rowCount === 0) throw notFound('DRAFT_NOT_FOUND', 'Draft not found');
    const updated = await db.query(
      `UPDATE cabinet_client_drafts
          SET current_step = COALESCE($3, current_step),
              payload = COALESCE($4::jsonb, payload),
              updated_at = now()
        WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
      [
        draftId,
        user.id,
        body.currentStep ?? null,
        body.payload !== undefined ? JSON.stringify(body.payload) : null,
      ],
    );
    return { draft: updated.rows[0] };
  });

  app.delete('/cabinet/workspace/drafts/:draftId', async (req) => {
    const user = req.user!;
    const { draftId } = req.params as { draftId: string };
    const deleted = await db.query(
      'DELETE FROM cabinet_client_drafts WHERE id = $1 AND owner_user_id = $2 RETURNING id',
      [draftId, user.id],
    );
    if (deleted.rowCount === 0) throw notFound('DRAFT_NOT_FOUND', 'Draft not found');
    return { ok: true };
  });

  /**
   * Activates a draft: creates the client company through the very same
   * provisioning path as `POST /companies`, then stores the onboarding state.
   * The draft is deleted only when the whole transaction succeeds.
   */
  app.post('/cabinet/workspace/drafts/:draftId/activate', async (req, reply) => {
    const user = req.user!;
    const { draftId } = req.params as { draftId: string };
    const found = await db.query<{ payload: any }>(
      'SELECT payload FROM cabinet_client_drafts WHERE id = $1 AND owner_user_id = $2',
      [draftId, user.id],
    );
    const draft = found.rows[0];
    if (!draft) throw notFound('DRAFT_NOT_FOUND', 'Draft not found');

    const payload = (draft.payload ?? {}) as any;
    const company = payload.company ?? {};
    const financial = payload.financial ?? {};
    const name = String(company.name ?? '').trim();
    if (!name) {
      throw badRequest('VALIDATION_ERROR', 'The registered business name is required', [
        { path: 'company.name', message: 'Registered business name is required' },
      ]);
    }
    const start = String(financial.financialYearStart ?? '');
    const end = String(financial.financialYearEnd ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
      throw badRequest('VALIDATION_ERROR', 'A valid financial year (end after start) is required', [
        { path: 'financial.financialYearStart', message: 'Financial year dates are required' },
      ]);
    }
    const currency = String(financial.functionalCurrency ?? 'MUR').toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
      throw badRequest('VALIDATION_ERROR', `Unsupported currency: ${currency}`);
    }
    if (company.brn) {
      const duplicate = await db.query(
        'SELECT 1 FROM companies WHERE lower(brn) = lower($1)',
        [String(company.brn).trim()],
      );
      if (duplicate.rowCount > 0) {
        throw conflict('CONFLICT', 'A client with this BRN already exists');
      }
    }
    if (!payload.sector) {
      throw badRequest('VALIDATION_ERROR', 'A business sector is required before activation');
    }
    const modules = normaliseModules(payload.modules);
    if (modules.length === 0) {
      throw badRequest('VALIDATION_ERROR', 'Select at least one module before activation');
    }
    const setup = normaliseAccountingSetup(payload.accountingSetup);
    if (!setup.accountingBasis || !setup.chartChoice || !setup.openingBalanceChoice || !setup.taxRegistration) {
      throw badRequest('VALIDATION_ERROR', 'The accounting setup is incomplete');
    }

    const created = await db.transaction(async (tx) => {
      // Double-submission guard: the draft row is locked and re-read inside the
      // transaction. Two concurrent activations of the same draft therefore
      // serialise; the loser finds the row deleted by the winner and gets 404
      // instead of creating a second company file.
      const stillThere = await tx.query<{ id: string }>(
        'SELECT id FROM cabinet_client_drafts WHERE id = $1 AND owner_user_id = $2 FOR UPDATE',
        [draftId, user.id],
      );
      if (!stillThere.rows[0]) throw notFound('DRAFT_NOT_FOUND', 'Draft not found');
      const row = await createClientFile(
        tx,
        user.id,
        {
          name,
          tradeName: company.tradeName ?? null,
          brn: company.brn ?? null,
          crn: company.crn ?? null,
          vatNumber: financial.vatNumber ?? null,
          registeredAddress: company.address ?? null,
          businessActivity: sectorDefinition(payload.sector)?.key ?? null,
          businessDescription: company.businessDescription ?? null,
          legalForm: company.legalForm ?? null,
          incorporationDate: company.incorporationDate ?? null,
          country: company.country ?? null,
          contactName: company.contactName ?? null,
          contactEmail: company.contactEmail ?? null,
          contactPhone: company.contactPhone ?? null,
          clientCode: company.clientCode ?? null,
          financialYearStart: start,
          financialYearEnd: end,
          functionalCurrency: currency,
          presentationCurrency: String(financial.presentationCurrency ?? currency).toUpperCase(),
          accountingStandard: financial.accountingStandard ?? 'IFRS',
          locale: user.locale ?? 'fr',
          withChart: setup.chartChoice !== 'import_later',
        },
        { ip: clientIp(req), source: 'onboarding' },
      );

      const kycChecks = payload.kyc?.checks ?? [];
      await tx.query(
        `INSERT INTO client_onboarding
           (company_id, status, kyc_review_status, current_step, sector, sector_notes,
            accounting_setup, selected_modules, assigned_accountant_id, activated_at, activated_by)
         VALUES ($1, 'approved', $2, 6, $3, $4, $5::jsonb, $6::jsonb, $7, now(), $8)`,
        [
          row.id,
          'in_progress',
          payload.sector,
          payload.sectorNotes ?? null,
          JSON.stringify(setup),
          JSON.stringify(modules),
          user.id,
          user.id,
        ],
      );
      await ensureKycChecks(tx, row.id);
      for (const check of kycChecks) {
        if (!KYC_TEMPLATE.some((item) => item.key === check.key)) continue;
        await tx.query(
          `UPDATE client_kyc_checks
              SET status = $3, document_ref = $4, note = $5, updated_by = $6, updated_at = now()
            WHERE company_id = $1 AND key = $2`,
          [row.id, check.key, check.status, check.documentRef ?? null, check.note ?? null, user.id],
        );
      }
      // Review status derived from the checklist (never from a filled field).
      const checksNow = await tx.query<{ required: boolean; status: string }>(
        'SELECT required, status FROM client_kyc_checks WHERE company_id = $1',
        [row.id],
      );
      const required = checksNow.rows.filter((r) => r.required);
      const allOk = required.length > 0 && required.every((r) => ['received', 'verified', 'not_applicable'].includes(r.status));
      const anyCorrection = checksNow.rows.some((r) => r.status === 'needs_correction');
      const review = anyCorrection ? 'in_progress' : allOk ? 'pending_review' : 'in_progress';
      await tx.query('UPDATE client_onboarding SET kyc_review_status = $2 WHERE company_id = $1', [
        row.id,
        review,
      ]);
      await tx.query('DELETE FROM cabinet_client_drafts WHERE id = $1', [draftId]);
      await writeAudit(tx, {
        companyId: row.id,
        userId: user.id,
        action: 'cabinet.onboarding.activate',
        entityType: 'company',
        entityId: row.id,
        details: { sector: payload.sector, modules, draftId },
        ip: clientIp(req),
      });
      return row;
    });

    const onboarding = onboardingView(await onboardingRow(created.id), created.id);
    const kycChecks = await kycChecksOf(created.id);
    return reply.code(201).send({
      company: created,
      onboarding,
      kycChecks,
      progress: progressFor(created, onboarding, kycChecks),
    });
  });

  /* ------------------------------------------------ onboarding catalogue */

  app.get('/cabinet/workspace/options', async () => ({
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
    /** The KYC checklist is not a legal validation; the UI states it. */
    legalValidation: false,
  }));
}

export type { OnboardingStepKey };
export { missingKycDocuments, isModuleCode };
