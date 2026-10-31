import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { effectiveAccess, type ModuleContext } from '../../lib/permissions.js';
import type { AccessLevel, ModuleName } from '../../types.js';
import type { AIService } from './service.js';
import { loadProposal, proposeManual, viewProposal } from './proposals.js';

/**
 * Universal assistant - read-only tool registry (mission 7).
 *
 * Every tool is:
 *  - declared once, with a Zod schema for its arguments (nothing unvalidated is
 *    ever executed);
 *  - scoped to the active company of the server-validated context;
 *  - checked against the module permissions on *each* call, never only when the
 *    conversation was opened;
 *  - strictly read-only, except `accounting.proposal.prepare`, which only
 *    creates a *draft proposal* through the existing V2 engine. Posting remains
 *    a separate human action.
 *
 * Adding a future tool (OCR, banking, documents) means adding one entry here:
 * nothing else in the assistant has to change.
 */

export interface AssistantContext {
  db: Db;
  service: AIService;
  userId: string;
  cabinetId: string;
  companyId: string;
  companyName: string;
  functionalCurrency: string;
  locale: 'fr' | 'en';
  module: ModuleName;
  screen: string | null;
  access: Record<ModuleName, AccessLevel>;
}

export interface AssistantAction {
  kind: 'proposal' | 'navigation';
  id?: string;
  title: { fr: string; en: string };
  description: { fr: string; en: string };
  dataUsed: string[];
  expected: { fr: string; en: string };
  risks: string[];
  examineHref?: string;
}

export interface ToolResult {
  data: Record<string, unknown>;
  lines: { fr: string[]; en: string[] };
  actions?: AssistantAction[];
  rowCount: number;
}

export interface ToolDefinition {
  key: string;
  module: ModuleName;
  readOnly: true;
  title: { fr: string; en: string };
  description: { fr: string; en: string };
  args: z.ZodTypeAny;
  run: (ctx: AssistantContext, args: any) => Promise<ToolResult>;
}

function requireAccess(ctx: AssistantContext, module: ModuleName, min: AccessLevel = 'read'): void {
  const weight: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };
  if (weight[ctx.access[module]] < weight[min]) {
    throw forbidden(`The "${module}" module requires ${min} access`, 'MODULE_FORBIDDEN');
  }
}

const money = (value: unknown) => `${formatAmount(parseAmount(value ?? '0'))}`;

const emptyArgs = z.object({}).strict();

const limitArg = z.object({ limit: z.number().int().min(1).max(50).optional() }).strict();

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  // ------------------------------------------------------------- cabinet
  {
    key: 'cabinet.companies',
    module: 'cabinet',
    readOnly: true,
    title: { fr: 'Rechercher les sociétés accessibles', en: 'Search accessible companies' },
    description: {
      fr: 'Liste les dossiers auxquels l’utilisateur a réellement accès.',
      en: 'Lists the dossiers the user can actually access.',
    },
    args: z
      .object({ query: z.string().trim().max(120).optional() })
      .strict(),
    async run(ctx, args) {
      const search = args.query ? `%${args.query}%` : null;
      const res = await ctx.db.query<{ id: string; name: string; brn: string | null; role: string }>(
        `SELECT c.id, c.name, c.brn, m.role
           FROM companies c
           JOIN company_members m ON m.company_id = c.id
          WHERE m.user_id = $1 AND ($2::text IS NULL OR c.name ILIKE $2)
          ORDER BY c.name LIMIT 25`,
        [ctx.userId, search],
      );
      return {
        data: { companies: res.rows },
        rowCount: res.rowCount ?? 0,
        lines: {
          fr:
            res.rowCount === 0
              ? ['Aucun dossier accessible ne correspond à cette recherche.']
              : res.rows.map((r) => `${r.name}${r.brn ? ` (BRN ${r.brn})` : ''} — rôle ${r.role}`),
          en:
            res.rowCount === 0
              ? ['No accessible dossier matches this search.']
              : res.rows.map((r) => `${r.name}${r.brn ? ` (BRN ${r.brn})` : ''} — role ${r.role}`),
        },
      };
    },
  },
  {
    key: 'cabinet.tasks.open',
    module: 'cabinet',
    readOnly: true,
    title: { fr: 'Tâches ouvertes', en: 'Open tasks' },
    description: {
      fr: 'Tâches à faire, en cours ou bloquées pour la société active.',
      en: 'Todo, in-progress or blocked tasks for the active company.',
    },
    args: z
      .object({
        overdueOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    async run(ctx, args) {
      const limit = args.limit ?? 10;
      const res = await ctx.db.query<{
        id: string;
        title: string;
        status: string;
        priority: string;
        due_date: string | null;
      }>(
        `SELECT id, title, status, priority, due_date
           FROM cabinet_tasks
          WHERE company_id = $1 AND status IN ('todo', 'in_progress', 'blocked')
            AND ($2::boolean IS NOT TRUE OR (due_date IS NOT NULL AND due_date < CURRENT_DATE))
          ORDER BY due_date NULLS LAST, created_at
          LIMIT $3`,
        [ctx.companyId, args.overdueOnly === true, limit],
      );
      const late = res.rows.filter((r) => r.due_date !== null && r.due_date < new Date().toISOString().slice(0, 10));
      return {
        data: { tasks: res.rows, overdueCount: late.length },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucune tâche ouverte pour ce dossier.']
              : [
                  `${res.rows.length} tâche(s) ouverte(s)${late.length > 0 ? `, dont ${late.length} en retard` : ''} :`,
                  ...res.rows.map(
                    (r) => `• ${r.title} — ${r.status}${r.due_date ? `, échéance ${r.due_date}` : ', sans échéance'}`,
                  ),
                ],
          en:
            res.rows.length === 0
              ? ['No open task for this dossier.']
              : [
                  `${res.rows.length} open task(s)${late.length > 0 ? `, ${late.length} overdue` : ''}:`,
                  ...res.rows.map(
                    (r) => `• ${r.title} — ${r.status}${r.due_date ? `, due ${r.due_date}` : ', no due date'}`,
                  ),
                ],
        },
        actions: [
          {
            kind: 'navigation',
            title: { fr: 'Ouvrir les tâches du cabinet', en: 'Open the cabinet tasks' },
            description: {
              fr: 'Retrouver ces tâches dans l’écran Tâches & échéances.',
              en: 'Find these tasks in the Tasks & deadlines screen.',
            },
            dataUsed: ['cabinet_tasks'],
            expected: { fr: 'Aucun changement de données.', en: 'No data change.' },
            risks: [],
            examineHref: '/cabinet/tasks',
          },
        ],
      };
    },
  },
  {
    key: 'cabinet.tasks.overdue',
    module: 'cabinet',
    readOnly: true,
    title: { fr: 'Tâches en retard', en: 'Overdue tasks' },
    description: { fr: 'Tâches échues et non terminées.', en: 'Past-due and unfinished tasks.' },
    args: emptyArgs,
    async run(ctx) {
      const tool = ASSISTANT_TOOLS.find((t) => t.key === 'cabinet.tasks.open')!;
      return tool.run(ctx, { overdueOnly: true, limit: 20 });
    },
  },
  {
    key: 'cabinet.deadlines',
    module: 'cabinet',
    readOnly: true,
    title: { fr: 'Échéances enregistrées', en: 'Recorded deadlines' },
    description: {
      fr: 'Échéances à venir (30 jours) et exercices comptables ouverts.',
      en: 'Upcoming deadlines (30 days) and open accounting periods.',
    },
    args: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
    async run(ctx, args) {
      const days = args.days ?? 30;
      const tasks = await ctx.db.query<{ title: string; due_date: string; status: string }>(
        `SELECT title, due_date::text, status
           FROM cabinet_tasks
          WHERE company_id = $1 AND due_date IS NOT NULL
            AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2::int)
            AND status NOT IN ('done', 'cancelled')
          ORDER BY due_date LIMIT 30`,
        [ctx.companyId, days],
      );
      const periods = await ctx.db.query<{ name: string; start_date: string; end_date: string }>(
        `SELECT name, start_date::text, end_date::text FROM accounting_periods
          WHERE company_id = $1 AND status = 'open' ORDER BY start_date`,
        [ctx.companyId],
      );
      return {
        data: { tasks: tasks.rows, openPeriods: periods.rows },
        rowCount: tasks.rows.length + periods.rows.length,
        lines: {
          fr: [
            `Échéances des ${days} prochains jours : ${tasks.rows.length}.`,
            ...tasks.rows.map((t) => `• ${t.due_date} — ${t.title}`),
            ...periods.rows.map((p) => `Exercice ouvert : ${p.name} (${p.start_date} → ${p.end_date}).`),
          ],
          en: [
            `Deadlines in the next ${days} days: ${tasks.rows.length}.`,
            ...tasks.rows.map((t) => `• ${t.due_date} — ${t.title}`),
            ...periods.rows.map((p) => `Open period: ${p.name} (${p.start_date} → ${p.end_date}).`),
          ],
        },
      };
    },
  },

  {
    key: 'migration.jobs.summary',
    module: 'cabinet',
    readOnly: true,
    title: { fr: 'État des imports de migration', en: 'Migration import status' },
    description: {
      fr: 'Résume les lots d’import (statut, contrôles) sans jamais écrire ni confirmer un import.',
      en: 'Summarises import jobs (status, controls) without ever writing or confirming an import.',
    },
    args: z.object({ limit: z.number().int().min(1).max(20).optional() }).strict(),
    async run(ctx, args) {
      requireAccess(ctx, 'cabinet', 'read');
      const limit = args.limit ?? 5;
      const res = await ctx.db.query<{
        id: string;
        import_kind: string;
        source: string;
        status: string;
        file_name: string;
        row_count: number;
        created_at: string;
        summary: Record<string, unknown>;
      }>(
        `SELECT id, import_kind, source, status, file_name, row_count, created_at::text, summary
           FROM migration_jobs
          WHERE company_id = $1
          ORDER BY created_at DESC LIMIT $2`,
        [ctx.companyId, limit],
      );
      const open = res.rows.filter((r) => !['imported', 'failed', 'cancelled'].includes(r.status));
      const errors = res.rows.reduce((total, row) => {
        const summary = (row.summary ?? {}) as { errors?: unknown };
        return total + (typeof summary.errors === 'number' ? summary.errors : 0);
      }, 0);
      return {
        data: { jobs: res.rows, openJobs: open.length, errors },
        rowCount: res.rows.length,
        lines: {
          fr: [
            `Lots de migration : ${res.rows.length} (dont ${open.length} en cours de préparation).`,
            ...res.rows.map(
              (r) =>
                `• ${r.file_name} — ${r.import_kind} / ${r.status} — ${r.row_count} ligne(s)`,
            ),
            errors > 0
              ? `${errors} erreur(s) de contrôle recensée(s) : un import bloqué ne crée aucune donnée.`
              : 'Aucune erreur de contrôle recensée sur les derniers lots.',
            'L’assistant ne peut ni confirmer ni exécuter un import : seule la validation humaine dans l’écran Importation & migration le permet.',
          ],
          en: [
            `Migration jobs: ${res.rows.length} (${open.length} being prepared).`,
            ...res.rows.map(
              (r) => `• ${r.file_name} — ${r.import_kind} / ${r.status} — ${r.row_count} row(s)`,
            ),
            errors > 0
              ? `${errors} control error(s) recorded: a blocked import creates no data.`
              : 'No control error recorded on the latest jobs.',
            'The assistant can neither confirm nor run an import: only human validation in the Import & migration screen can.',
          ],
        },
        actions: [
          {
            kind: 'navigation',
            title: { fr: 'Ouvrir l’assistant de migration', en: 'Open the migration assistant' },
            description: {
              fr: 'Contrôler puis confirmer un import manuellement.',
              en: 'Review and confirm an import manually.',
            },
            dataUsed: ['migration_jobs'],
            expected: { fr: 'Aucun changement sans validation humaine.', en: 'No change without human validation.' },
            risks: [],
            examineHref: '/cabinet/migration',
          },
        ],
      };
    },
  },

  // ------------------------------------------------------------- billing
  {
    key: 'billing.invoices.search',
    module: 'billing',
    readOnly: true,
    title: { fr: 'Rechercher une facture', en: 'Search an invoice' },
    description: {
      fr: 'Recherche par numéro, client ou montant, sans jamais inventer de document.',
      en: 'Search by number, customer or amount, never inventing a document.',
    },
    args: z
      .object({
        query: z.string().trim().max(120).optional(),
        unpaidOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    async run(ctx, args) {
      const limit = args.limit ?? 10;
      const search = args.query ? `%${args.query}%` : null;
      const res = await ctx.db.query<{
        id: string;
        doc_no: string | null;
        status: string;
        payment_status: string;
        customer_name: string;
        issue_date: string;
        due_date: string | null;
        currency: string;
        total_amount: string;
        amount_paid: string;
        credited_amount: string;
      }>(
        `SELECT id, doc_no, status, payment_status, customer_name, issue_date::text, due_date::text,
                currency, total_amount::text, amount_paid::text, credited_amount::text
           FROM billing_documents
          WHERE company_id = $1 AND kind = 'invoice'
            AND ($2::text IS NULL OR doc_no ILIKE $2 OR customer_name ILIKE $2 OR total_amount::text = $2)
            AND ($3::boolean IS NOT TRUE OR status IN ('issued', 'partially_paid'))
          ORDER BY issue_date DESC LIMIT $4`,
        [ctx.companyId, search, args.unpaidOnly === true, limit],
      );
      const outstanding = res.rows.map((r) => {
        const due = parseAmount(r.total_amount) - parseAmount(r.amount_paid) - parseAmount(r.credited_amount);
        return { ...r, outstanding: formatAmount(due > 0n ? due : 0n) };
      });
      return {
        data: { invoices: outstanding },
        rowCount: outstanding.length,
        lines: {
          fr:
            outstanding.length === 0
              ? ['Aucune facture ne correspond à cette recherche dans ce dossier.']
              : outstanding.map(
                  (r) =>
                    `• ${r.doc_no ?? '(brouillon)'} — ${r.customer_name} — ${money(r.total_amount)} ${r.currency}, reste dû ${money(r.outstanding)} (${r.status})`,
                ),
          en:
            outstanding.length === 0
              ? ['No invoice matches this search in this dossier.']
              : outstanding.map(
                  (r) =>
                    `• ${r.doc_no ?? '(draft)'} — ${r.customer_name} — ${money(r.total_amount)} ${r.currency}, outstanding ${money(r.outstanding)} (${r.status})`,
                ),
        },
      };
    },
  },
  {
    key: 'billing.invoices.unpaid',
    module: 'billing',
    readOnly: true,
    title: { fr: 'Factures impayées', en: 'Unpaid invoices' },
    description: {
      fr: 'Factures émises dont le solde dû est supérieur à zéro.',
      en: 'Issued invoices whose outstanding balance is above zero.',
    },
    args: limitArg,
    async run(ctx, args) {
      const tool = ASSISTANT_TOOLS.find((t) => t.key === 'billing.invoices.search')!;
      const result = await tool.run(ctx, { unpaidOnly: true, limit: args.limit ?? 10 });
      const invoices = (result.data.invoices as { outstanding: string }[]).filter(
        (i) => parseAmount(i.outstanding) > 0n,
      );
      const total = invoices.reduce((acc, i) => acc + parseAmount(i.outstanding), 0n);
      return {
        ...result,
        rowCount: invoices.length,
        data: { ...result.data, invoices, totalOutstanding: formatAmount(total) },
        lines: {
          fr:
            invoices.length === 0
              ? ['Aucune facture impayée : tous les soldes sont à zéro.']
              : [
                  `${invoices.length} facture(s) impayée(s), total dû ${money(total)} :`,
                  ...result.lines.fr.slice(0, invoices.length),
                ],
          en:
            invoices.length === 0
              ? ['No unpaid invoice: every balance is zero.']
              : [
                  `${invoices.length} unpaid invoice(s), total due ${money(total)}:`,
                  ...result.lines.en.slice(0, invoices.length),
                ],
        },
      };
    },
  },
  {
    key: 'billing.customers.balance',
    module: 'billing',
    readOnly: true,
    title: { fr: 'Solde d’un client', en: 'Customer balance' },
    description: {
      fr: 'Solde dû calculé depuis les factures, encaissements et avoirs réels.',
      en: 'Outstanding balance computed from actual invoices, payments and credit notes.',
    },
    args: z.object({ customerName: z.string().trim().min(2).max(120).optional() }).strict(),
    async run(ctx, args) {
      const search = args.customerName ? `%${args.customerName}%` : null;
      const res = await ctx.db.query<{
        id: string;
        name: string;
        currency: string;
        invoiced: string;
        paid: string;
        credited: string;
      }>(
        `SELECT c.id, c.name,
                COALESCE(MAX(d.currency), 'MUR') AS currency,
                COALESCE(SUM(d.total_amount), 0)::text AS invoiced,
                COALESCE(SUM(d.amount_paid), 0)::text AS paid,
                COALESCE(SUM(d.credited_amount), 0)::text AS credited
           FROM billing_customers c
           LEFT JOIN billing_documents d
             ON d.customer_id = c.id AND d.kind = 'invoice' AND d.status NOT IN ('draft', 'cancelled')
          WHERE c.company_id = $1 AND c.archived_at IS NULL
            AND ($2::text IS NULL OR c.name ILIKE $2)
          GROUP BY c.id, c.name
          ORDER BY c.name LIMIT 10`,
        [ctx.companyId, search],
      );
      const rows = res.rows.map((r) => {
        const due = parseAmount(r.invoiced) - parseAmount(r.paid) - parseAmount(r.credited);
        return { ...r, outstanding: formatAmount(due > 0n ? due : 0n) };
      });
      return {
        data: { customers: rows },
        rowCount: rows.length,
        lines: {
          fr:
            rows.length === 0
              ? ['Aucun client ne correspond, ou aucun solde n’est disponible.']
              : rows.map(
                  (r) =>
                    `• ${r.name} : facturé ${money(r.invoiced)}, encaissé ${money(r.paid)}, crédité ${money(r.credited)}, solde dû ${money(r.outstanding)} ${r.currency}`,
                ),
          en:
            rows.length === 0
              ? ['No matching customer, or no balance available.']
              : rows.map(
                  (r) =>
                    `• ${r.name}: invoiced ${money(r.invoiced)}, received ${money(r.paid)}, credited ${money(r.credited)}, outstanding ${money(r.outstanding)} ${r.currency}`,
                ),
        },
      };
    },
  },
  {
    key: 'billing.payments.recent',
    module: 'billing',
    readOnly: true,
    title: { fr: 'Encaissements récents', en: 'Recent payments' },
    description: { fr: 'Derniers encaissements enregistrés.', en: 'Latest recorded payments.' },
    args: limitArg,
    async run(ctx, args) {
      const res = await ctx.db.query<{
        payment_no: string | null;
        payment_date: string;
        amount: string;
        currency: string;
        method: string;
        unallocated_amount: string;
        customer_name: string;
      }>(
        `SELECT p.payment_no, p.payment_date::text, p.amount::text, p.currency, p.method,
                p.unallocated_amount::text, c.name AS customer_name
           FROM billing_payments p
           JOIN billing_customers c ON c.id = p.customer_id
          WHERE p.company_id = $1 AND p.status = 'recorded'
          ORDER BY p.payment_date DESC, p.created_at DESC LIMIT $2`,
        [ctx.companyId, args.limit ?? 10],
      );
      return {
        data: { payments: res.rows },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucun encaissement enregistré pour ce dossier.']
              : res.rows.map(
                  (r) =>
                    `• ${r.payment_date} — ${r.customer_name} — ${money(r.amount)} ${r.currency} (${r.method}), non affecté ${money(r.unallocated_amount)}`,
                ),
          en:
            res.rows.length === 0
              ? ['No payment recorded for this dossier.']
              : res.rows.map(
                  (r) =>
                    `• ${r.payment_date} — ${r.customer_name} — ${money(r.amount)} ${r.currency} (${r.method}), unallocated ${money(r.unallocated_amount)}`,
                ),
        },
      };
    },
  },
  {
    key: 'billing.approvals.pending',
    module: 'billing',
    readOnly: true,
    title: { fr: 'Documents en attente de validation', en: 'Documents awaiting validation' },
    description: {
      fr: 'Brouillons de documents et propositions d’écriture à examiner.',
      en: 'Draft documents and entry proposals awaiting review.',
    },
    args: emptyArgs,
    async run(ctx) {
      requireAccess(ctx, 'accounting', 'read');
      const docs = await ctx.db.query<{ kind: string; status: string; count: number }>(
        `SELECT kind, status, count(*)::int AS count FROM billing_documents
          WHERE company_id = $1 AND status = 'draft' GROUP BY kind, status`,
        [ctx.companyId],
      );
      const proposals = await ctx.db.query<{ id: string; description: string; status: string; entry_date: string }>(
        `SELECT id, description, status, entry_date::text FROM ai_entry_proposals
          WHERE company_id = $1 AND status IN ('proposed', 'validated') ORDER BY created_at DESC LIMIT 20`,
        [ctx.companyId],
      );
      return {
        data: { documents: docs.rows, proposals: proposals.rows },
        rowCount: docs.rows.length + proposals.rows.length,
        lines: {
          fr: [
            `Brouillons de documents : ${docs.rows.reduce((a, r) => a + Number(r.count), 0)}.`,
            `Propositions d’écriture à examiner : ${proposals.rows.length}.`,
            ...proposals.rows.map((p) => `• ${p.entry_date} — ${p.description} (${p.status})`),
          ],
          en: [
            `Draft documents: ${docs.rows.reduce((a, r) => a + Number(r.count), 0)}.`,
            `Entry proposals awaiting review: ${proposals.rows.length}.`,
            ...proposals.rows.map((p) => `• ${p.entry_date} — ${p.description} (${p.status})`),
          ],
        },
        actions: [
          {
            kind: 'navigation',
            title: { fr: 'Examiner les propositions', en: 'Review the proposals' },
            description: {
              fr: 'Ouvrir l’écran des propositions d’écriture (validation humaine séparée).',
              en: 'Open the entry proposals screen (human validation is separate).',
            },
            dataUsed: ['ai_entry_proposals', 'billing_documents'],
            expected: { fr: 'Aucune écriture créée automatiquement.', en: 'No entry created automatically.' },
            risks: [],
            examineHref: '/cabinet/ai-proposals',
          },
        ],
      };
    },
  },

  // --------------------------------------------------------- accounting
  {
    key: 'accounting.accounts.search',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Rechercher un compte', en: 'Search an account' },
    description: {
      fr: 'Recherche par code ou libellé dans le plan comptable réel de la société.',
      en: 'Search by code or name in the company actual chart of accounts.',
    },
    args: z.object({ query: z.string().trim().min(1).max(80) }).strict(),
    async run(ctx, args) {
      const res = await ctx.db.query<{ code: string; name: string; type: string; is_active: boolean }>(
        `SELECT code, name, type, is_active FROM accounts
          WHERE company_id = $1 AND (code ILIKE $2 OR name ILIKE $2)
          ORDER BY code LIMIT 20`,
        [ctx.companyId, `%${args.query}%`],
      );
      return {
        data: { accounts: res.rows },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucun compte ne correspond dans ce plan comptable.']
              : res.rows.map((r) => `${r.code} — ${r.name} (${r.type}${r.is_active ? '' : ', inactif'})`),
          en:
            res.rows.length === 0
              ? ['No account matches in this chart of accounts.']
              : res.rows.map((r) => `${r.code} — ${r.name} (${r.type}${r.is_active ? '' : ', inactive'})`),
        },
      };
    },
  },
  {
    key: 'accounting.trialBalance',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Consulter la balance', en: 'Read the trial balance' },
    description: {
      fr: 'Balance des écritures comptabilisées, par exercice ouvert ou à une date donnée.',
      en: 'Trial balance of posted entries, for the open period or a given date.',
    },
    args: z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
    async run(ctx, args) {
      const asOf = args.asOf ?? new Date().toISOString().slice(0, 10);
      const res = await ctx.db.query<{ debit: string; credit: string; lines: number }>(
        `SELECT COALESCE(SUM(l.debit), 0)::text AS debit,
                COALESCE(SUM(l.credit), 0)::text AS credit,
                count(*)::int AS lines
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.entry_id
          WHERE e.company_id = $1 AND e.status = 'posted' AND e.entry_date <= $2`,
        [ctx.companyId, asOf],
      );
      const row = res.rows[0] ?? { debit: '0', credit: '0', lines: 0 };
      const balanced = parseAmount(row.debit) === parseAmount(row.credit);
      return {
        data: { asOf, ...row, balanced },
        rowCount: Number(row.lines),
        lines: {
          fr: [
            `Au ${asOf} : débit ${money(row.debit)}, crédit ${money(row.credit)} ${ctx.functionalCurrency}.`,
            balanced ? 'La balance est équilibrée.' : 'La balance n’est pas équilibrée : vérification requise.',
          ],
          en: [
            `As of ${asOf}: debit ${money(row.debit)}, credit ${money(row.credit)} ${ctx.functionalCurrency}.`,
            balanced ? 'The trial balance is balanced.' : 'The trial balance is not balanced: review required.',
          ],
        },
      };
    },
  },
  {
    key: 'accounting.proposal.check',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Vérifier une proposition', en: 'Check a proposal' },
    description: {
      fr: 'Rejoue les contrôles comptables d’une proposition, sans jamais la comptabiliser.',
      en: 'Re-runs the accounting checks of a proposal, never posting it.',
    },
    args: z.object({ proposalId: z.string().uuid() }).strict(),
    async run(ctx, args) {
      const loaded = await loadProposal(ctx.db, ctx.cabinetId, ctx.companyId, args.proposalId);
      const view = await viewProposal(ctx.db, ctx.cabinetId, ctx.companyId, loaded.proposal, loaded.lines);
      const blocking = view.checks.filter((c) => !c.ok && c.severity === 'error');
      const warnings = view.checks.filter((c) => !c.ok && c.severity === 'warning');
      return {
        data: { proposal: view },
        rowCount: view.lines.length,
        lines: {
          fr: [
            `Proposition « ${view.description} » : ${view.totals.balanced ? 'équilibrée' : 'déséquilibrée'} (${money(view.totals.debit)} au débit).`,
            blocking.length === 0
              ? 'Aucun contrôle bloquant.'
              : `Contrôles bloquants : ${blocking.map((c) => c.label).join(', ')}.`,
            warnings.length > 0 ? `Avertissements : ${warnings.map((c) => c.label).join(', ')}.` : 'Aucun avertissement.',
            'Aucune écriture n’a été créée : la validation et la comptabilisation restent des actions humaines séparées.',
          ],
          en: [
            `Proposal "${view.description}": ${view.totals.balanced ? 'balanced' : 'unbalanced'} (${money(view.totals.debit)} debit).`,
            blocking.length === 0
              ? 'No blocking check.'
              : `Blocking checks: ${blocking.map((c) => c.label).join(', ')}.`,
            warnings.length > 0 ? `Warnings: ${warnings.map((c) => c.label).join(', ')}.` : 'No warning.',
            'No entry was created: validation and posting remain separate human actions.',
          ],
        },
        actions: [
          {
            kind: 'proposal',
            id: view.id,
            title: { fr: 'Examiner la proposition', en: 'Review the proposal' },
            description: {
              fr: view.description,
              en: view.description,
            },
            dataUsed: ['ai_entry_proposals', 'journal_lines'],
            expected: {
              fr: 'Aucune écriture tant que vous ne validez pas puis ne comptabilisez pas explicitement.',
              en: 'No entry until you explicitly validate and then post.',
            },
            risks: warnings.map((w) => w.message),
            examineHref: `/cabinet/ai-proposals?proposal=${view.id}`,
          },
        ],
      };
    },
  },
  {
    key: 'accounting.proposal.prepare',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Préparer une proposition d’écriture', en: 'Prepare an entry proposal' },
    description: {
      fr: 'Crée un brouillon via l’Assistant V2 : aucun compte, taux ou justificatif n’est inventé.',
      en: 'Creates a draft through Assistant V2: no account, rate or document is invented.',
    },
    args: z
      .object({
        description: z.string().trim().min(5).max(300),
        amount: z
          .union([z.string().regex(/^\d{1,15}(\.\d{1,4})?$/), z.number().min(0).max(1e15)])
          .optional(),
        currency: z.string().length(3).toUpperCase().optional(),
        entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .strict(),
    async run(ctx, args) {
      if (parseAmount(args.amount ?? '0') <= 0n) {
        throw new AppError(
          'AI_INPUT_INCOMPLETE',
          422,
          'Un montant strictement positif est nécessaire pour préparer une écriture.',
        );
      }
      const result = await proposeManual(ctx.db, ctx.service, {
        cabinetId: ctx.cabinetId,
        companyId: ctx.companyId,
        userId: ctx.userId,
        description: args.description,
        amount: args.amount === undefined ? null : String(args.amount),
        currency: args.currency ?? ctx.functionalCurrency,
        entryDate: args.entryDate ?? null,
        reference: null,
      });
      const proposal = result.proposal;
      return {
        data: { proposal, entryCreated: false },
        rowCount: proposal.lines.length,
        lines: {
          fr: [
            `Proposition préparée : « ${proposal.description} » (${proposal.journalCode ?? 'journal à choisir'}).`,
            ...proposal.lines.map(
              (l) =>
                `• ${l.accountCode} ${l.accountName} — débit ${money(l.debit)}, crédit ${money(l.credit)}`,
            ),
            proposal.totals.balanced
              ? `Équilibrée : ${money(proposal.totals.debit)} au débit et au crédit.`
              : `Déséquilibrée : écart ${money(proposal.totals.difference)}.`,
            ...proposal.warnings,
            ...proposal.missing.map((m) => `Manquant : ${m}`),
            'Aucune écriture comptable n’a été créée : validation puis comptabilisation humaines requises.',
          ],
          en: [
            `Proposal prepared: "${proposal.description}" (${proposal.journalCode ?? 'journal to choose'}).`,
            ...proposal.lines.map(
              (l) =>
                `• ${l.accountCode} ${l.accountName} — debit ${money(l.debit)}, credit ${money(l.credit)}`,
            ),
            proposal.totals.balanced
              ? `Balanced: ${money(proposal.totals.debit)} debit and credit.`
              : `Unbalanced: difference ${money(proposal.totals.difference)}.`,
            ...proposal.warnings,
            ...proposal.missing.map((m) => `Missing: ${m}`),
            'No accounting entry was created: human validation then posting are required.',
          ],
        },
        actions: [
          {
            kind: 'proposal',
            id: proposal.id,
            title: { fr: 'Examiner la proposition d’écriture', en: 'Review the entry proposal' },
            description: { fr: proposal.description, en: proposal.description },
            dataUsed: ['plan comptable', 'journaux', 'règles validées'],
            expected: {
              fr: 'Proposition éditable, sans impact comptable tant qu’elle n’est pas comptabilisée.',
              en: 'Editable proposal, with no accounting impact until it is posted.',
            },
            risks: [...proposal.warnings, ...proposal.missing],
            examineHref: `/cabinet/ai-proposals?proposal=${proposal.id}`,
          },
        ],
      };
    },
  },

  // ------------------------------------------------------- purchases (mission 11)
  {
    key: 'purchases.suppliers.search',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Rechercher les fournisseurs', en: 'Search suppliers' },
    description: {
      fr: 'Liste les fournisseurs du dossier actif et leur solde par devise.',
      en: 'Lists the active dossier suppliers and their balance by currency.',
    },
    args: z
      .object({ query: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(50).optional() })
      .strict(),
    async run(ctx, args) {
      requireAccess(ctx, 'accounting', 'read');
      const search = args.query ? `%${args.query}%` : null;
      const limit = args.limit ?? 10;
      const res = await ctx.db.query<any>(
        `SELECT s.id, s.name, s.reference, s.country, s.preferred_currency,
                COALESCE(SUM(CASE WHEN d.kind = 'invoice' AND d.status = 'validated'
                  THEN GREATEST(d.total_amount - d.amount_paid - d.credited_amount, 0) ELSE 0 END), 0)::text AS outstanding,
                MIN(d.currency) AS currency
           FROM purchase_suppliers s
           LEFT JOIN purchase_documents d ON d.supplier_id = s.id AND d.company_id = s.company_id
          WHERE s.company_id = $1 AND s.is_active
            AND ($2::text IS NULL OR s.name ILIKE $2 OR s.reference ILIKE $2 OR s.tax_number ILIKE $2)
          GROUP BY s.id
          ORDER BY s.name LIMIT $3`,
        [ctx.companyId, search, limit],
      );
      return {
        data: { suppliers: res.rows },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucun fournisseur actif ne correspond à cette recherche.']
              : res.rows.map(
                  (r) =>
                    `• ${r.name}${r.reference ? ` (${r.reference})` : ''} — ${r.country}${r.currency ? `, solde ${money(r.outstanding)} ${r.currency}` : ', aucun solde ouvert'}`,
                ),
          en:
            res.rows.length === 0
              ? ['No active supplier matches this search.']
              : res.rows.map(
                  (r) =>
                    `• ${r.name}${r.reference ? ` (${r.reference})` : ''} — ${r.country}${r.currency ? `, balance ${money(r.outstanding)} ${r.currency}` : ', no open balance'}`,
                ),
        },
        actions: [
          {
            kind: 'navigation',
            title: { fr: 'Ouvrir Achats & Fournisseurs', en: 'Open Purchases & Suppliers' },
            description: { fr: 'Consulter les fiches et les soldes fournisseurs.', en: 'View supplier records and balances.' },
            dataUsed: ['purchase_suppliers', 'purchase_documents'],
            expected: { fr: 'Aucune modification.', en: 'No change.' },
            risks: [],
            examineHref: '/accounting/purchases?tab=suppliers',
          },
        ],
      };
    },
  },
  {
    key: 'purchases.invoices.search',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Rechercher les factures fournisseurs', en: 'Search supplier invoices' },
    description: {
      fr: 'Factures d’achat validées, échéances et restant dû exact.',
      en: 'Validated purchase invoices, due dates and exact outstanding.',
    },
    args: z
      .object({
        query: z.string().trim().max(120).optional(),
        overdueOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    async run(ctx, args) {
      requireAccess(ctx, 'accounting', 'read');
      const search = args.query ? `%${args.query}%` : null;
      const limit = args.limit ?? 10;
      const res = await ctx.db.query<any>(
        `SELECT d.id, d.doc_no, d.supplier_reference, d.issue_date, d.due_date, d.currency,
                d.total_amount::text, d.amount_paid::text, d.credited_amount::text,
                (d.total_amount - d.amount_paid - d.credited_amount)::text AS outstanding,
                d.payment_status, d.accounting_entry_id, s.name AS supplier_name
           FROM purchase_documents d
           JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
          WHERE d.company_id = $1 AND d.kind = 'invoice' AND d.status = 'validated'
            AND d.total_amount - d.amount_paid - d.credited_amount > 0
            AND ($2::text IS NULL OR s.name ILIKE $2 OR d.doc_no ILIKE $2 OR d.supplier_reference ILIKE $2)
            AND ($3::boolean IS NOT TRUE OR (d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE))
          ORDER BY d.due_date NULLS LAST, d.issue_date
          LIMIT $4`,
        [ctx.companyId, search, args.overdueOnly === true, limit],
      );
      return {
        data: { invoices: res.rows },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucune facture fournisseur ouverte ne correspond à cette recherche.']
              : [
                  `${res.rows.length} facture(s) fournisseur ouverte(s) :`,
                  ...res.rows.map(
                    (r) =>
                      `• ${r.doc_no ?? 'brouillon'} — ${r.supplier_name}, ${r.currency} ${money(r.outstanding)} restant, échéance ${r.due_date ?? 'non renseignée'}${r.accounting_entry_id ? ', comptabilisée' : ', non comptabilisée'}`,
                  ),
                ],
          en:
            res.rows.length === 0
              ? ['No open supplier invoice matches this search.']
              : [
                  `${res.rows.length} open supplier invoice(s):`,
                  ...res.rows.map(
                    (r) =>
                      `• ${r.doc_no ?? 'draft'} — ${r.supplier_name}, ${r.currency} ${money(r.outstanding)} outstanding, due ${r.due_date ?? 'not set'}${r.accounting_entry_id ? ', posted' : ', not posted'}`,
                  ),
                ],
        },
        actions: [
          {
            kind: 'navigation',
            title: { fr: 'Ouvrir les factures d’achat', en: 'Open purchase invoices' },
            description: { fr: 'Consulter les échéances et restants dus.', en: 'View due dates and outstanding balances.' },
            dataUsed: ['purchase_documents', 'purchase_suppliers'],
            expected: { fr: 'Aucune modification.', en: 'No change.' },
            risks: [],
            examineHref: '/accounting/purchases?tab=invoices',
          },
        ],
      };
    },
  },
  {
    key: 'purchases.aging',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Dettes fournisseurs par échéance', en: 'Supplier debt by due date' },
    description: {
      fr: 'Restant dû, échu et à échoir, séparés par devise sans addition entre devises.',
      en: 'Outstanding, overdue and upcoming amounts, separated by currency.',
    },
    args: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
    async run(ctx, args) {
      requireAccess(ctx, 'accounting', 'read');
      const days = args.days ?? 30;
      const res = await ctx.db.query<any>(
        `SELECT d.currency,
                COALESCE(SUM(GREATEST(d.total_amount - d.amount_paid - d.credited_amount, 0)), 0)::text AS outstanding,
                COALESCE(SUM(CASE WHEN d.due_date < CURRENT_DATE
                  THEN GREATEST(d.total_amount - d.amount_paid - d.credited_amount, 0) ELSE 0 END), 0)::text AS overdue,
                COALESCE(SUM(CASE WHEN d.due_date >= CURRENT_DATE
                  AND d.due_date <= CURRENT_DATE + ($2::int || ' days')::interval
                  THEN GREATEST(d.total_amount - d.amount_paid - d.credited_amount, 0) ELSE 0 END), 0)::text AS due_soon,
                count(*)::text AS invoices
           FROM purchase_documents d
          WHERE d.company_id = $1 AND d.kind = 'invoice' AND d.status = 'validated'
            AND d.total_amount - d.amount_paid - d.credited_amount > 0
          GROUP BY d.currency ORDER BY d.currency`,
        [ctx.companyId, days],
      );
      return {
        data: { currencies: res.rows, days },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucune dette fournisseur ouverte.']
              : [
                  `Dettes fournisseurs ouvertes (${days} jours) :`,
                  ...res.rows.map(
                    (r) =>
                      `• ${r.currency} — ${money(r.outstanding)} restant, ${money(r.overdue)} échu, ${money(r.due_soon)} à échoir, ${r.invoices} facture(s).`,
                  ),
                  'Les devises ne sont jamais additionnées.',
                ],
          en:
            res.rows.length === 0
              ? ['No open supplier debt.']
              : [
                  `Open supplier debt (${days} days):`,
                  ...res.rows.map(
                    (r) =>
                      `• ${r.currency} — ${money(r.outstanding)} outstanding, ${money(r.overdue)} overdue, ${money(r.due_soon)} due soon, ${r.invoices} invoice(s).`,
                  ),
                  'Currencies are never added together.',
                ],
        },
        actions: [
          {
            kind: 'navigation',
            title: { fr: 'Ouvrir l’échéancier fournisseurs', en: 'Open supplier aging' },
            description: { fr: 'Filtrer et exporter le rapport.', en: 'Filter and export the report.' },
            dataUsed: ['purchase_documents'],
            expected: { fr: 'Aucune modification.', en: 'No change.' },
            risks: [],
            examineHref: '/accounting/purchases?tab=aging',
          },
        ],
      };
    },
  },
  {
    key: 'purchases.duplicates',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Factures fournisseurs potentiellement en double', en: 'Potential duplicate purchase invoices' },
    description: {
      fr: 'Signale les mêmes montants et dates pour un fournisseur ; ne fusionne rien.',
      en: 'Flags identical amounts and dates for a supplier; merges nothing.',
    },
    args: emptyArgs,
    async run(ctx) {
      requireAccess(ctx, 'accounting', 'read');
      const res = await ctx.db.query<any>(
        `SELECT s.name AS supplier_name, d.currency, d.total_amount::text,
                d.issue_date, count(*)::text AS occurrences,
                string_agg(COALESCE(d.doc_no, 'brouillon'), ', ' ORDER BY d.created_at) AS documents
           FROM purchase_documents d
           JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
          WHERE d.company_id = $1 AND d.status <> 'cancelled'
          GROUP BY s.name, d.currency, d.total_amount, d.issue_date
         HAVING count(*) > 1
          ORDER BY d.issue_date DESC LIMIT 20`,
        [ctx.companyId],
      );
      return {
        data: { groups: res.rows },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucun doublon potentiel détecté sur le montant et la date.']
              : [
                  'Doublons potentiels (aucune fusion automatique) :',
                  ...res.rows.map(
                    (r) =>
                      `• ${r.supplier_name} — ${r.currency} ${money(r.total_amount)} le ${r.issue_date}, ${r.documents}`,
                  ),
                ],
          en:
            res.rows.length === 0
              ? ['No potential duplicate by amount and date.']
              : [
                  'Potential duplicates (no automatic merge):',
                  ...res.rows.map(
                    (r) =>
                      `• ${r.supplier_name} — ${r.currency} ${money(r.total_amount)} on ${r.issue_date}, ${r.documents}`,
                  ),
                ],
        },
      };
    },
  },
  {
    key: 'purchases.payments.recent',
    module: 'accounting',
    readOnly: true,
    title: { fr: 'Règlements fournisseurs récents', en: 'Recent supplier payments' },
    description: {
      fr: 'Règlements enregistrés, leurs affectations et leur état comptable.',
      en: 'Recorded payments, their allocations and accounting state.',
    },
    args: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    async run(ctx, args) {
      requireAccess(ctx, 'accounting', 'read');
      const res = await ctx.db.query<any>(
        `SELECT p.payment_no, p.payment_date, p.amount::text, p.currency, p.kind, p.reference,
                p.accounting_entry_id, s.name AS supplier_name,
                (SELECT count(*)::text FROM purchase_payment_allocations a
                  WHERE a.payment_id = p.id AND a.cancelled_at IS NULL) AS allocations
           FROM purchase_payments p
           JOIN purchase_suppliers s ON s.id = p.supplier_id AND s.company_id = p.company_id
          WHERE p.company_id = $1 AND p.status = 'recorded'
          ORDER BY p.payment_date DESC, p.created_at DESC LIMIT $2`,
        [ctx.companyId, args.limit ?? 10],
      );
      return {
        data: { payments: res.rows },
        rowCount: res.rows.length,
        lines: {
          fr:
            res.rows.length === 0
              ? ['Aucun règlement fournisseur enregistré.']
              : res.rows.map(
                  (r) =>
                    `• ${r.payment_no ?? 'sans numéro'} — ${r.supplier_name}, ${money(r.amount)} ${r.currency}, ${r.allocations} affectation(s)${r.accounting_entry_id ? ', comptabilisé' : ', non comptabilisé'}`,
                ),
          en:
            res.rows.length === 0
              ? ['No recorded supplier payment.']
              : res.rows.map(
                  (r) =>
                    `• ${r.payment_no ?? 'no number'} — ${r.supplier_name}, ${money(r.amount)} ${r.currency}, ${r.allocations} allocation(s)${r.accounting_entry_id ? ', posted' : ', not posted'}`,
                ),
        },
      };
    },
  },
  // -------------------------------------------------------------- payroll
  {
    key: 'payroll.status',
    module: 'payroll',
    readOnly: true,
    title: { fr: 'État des fonctions Paie & RH', en: 'Payroll module status' },
    description: {
      fr: 'Explique honnêtement que la paie mauricienne n’est pas implémentée.',
      en: 'Honestly explains that Mauritian payroll is not implemented.',
    },
    args: emptyArgs,
    async run(ctx) {
      requireAccess(ctx, 'payroll', 'read');
      return {
        data: { implemented: false },
        rowCount: 0,
        lines: {
          fr: [
            'Le module Paie & RH est préparé mais non implémenté : aucun bulletin, aucun taux PAYE/CSG/NSF et aucune déclaration ne sont calculés.',
            'Aucune donnée de paie n’est lue ni inventée par l’assistant.',
          ],
          en: [
            'The Payroll & HR module is prepared but not implemented: no payslip, PAYE/CSG/NSF rate or statutory declaration is computed.',
            'The assistant neither reads nor invents payroll data.',
          ],
        },
      };
    },
  },
];

export const TOOL_BY_KEY = new Map(ASSISTANT_TOOLS.map((tool) => [tool.key, tool]));

/** Catalogue exposed to the UI (no sensitive information, no SQL). */
export function toolCatalogue() {
  return ASSISTANT_TOOLS.map((tool) => ({
    key: tool.key,
    module: tool.module,
    readOnly: tool.readOnly,
    title: tool.title,
    description: tool.description,
  }));
}

export async function effectiveAccessFor(
  db: Db,
  companyId: string,
  userId: string,
  role: ModuleContext['role'],
): Promise<Record<ModuleName, AccessLevel>> {
  const [cabinet, accounting, billing, payroll] = await Promise.all([
    effectiveAccess(db, companyId, userId, role, 'cabinet'),
    effectiveAccess(db, companyId, userId, role, 'accounting'),
    effectiveAccess(db, companyId, userId, role, 'billing'),
    effectiveAccess(db, companyId, userId, role, 'payroll'),
  ]);
  return { cabinet, accounting, billing, payroll };
}

export function assertKnownTool(key: string): ToolDefinition {
  const tool = TOOL_BY_KEY.get(key);
  if (!tool) throw notFound('AI_TOOL_UNKNOWN', 'Unknown assistant tool');
  return tool;
}
