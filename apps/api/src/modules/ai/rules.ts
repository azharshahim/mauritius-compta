import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { normalise } from './simulation.js';

/**
 * Deterministic learned rules (mission 6).
 *
 * "Learning" means reusing a decision a human validated - never training a
 * model on cabinet data. A rule belongs to one company; a rule of company A is
 * never read for company B, even inside the same cabinet.
 *
 * Versioning: an active rule is unique per (company, type, normalised key). A
 * new decision deactivates the previous version and links it to its successor,
 * so the history and the author of every version stay available. An ambiguous
 * match (two rules of equal priority pointing at different accounts) is
 * reported and never applied silently.
 */

export type RuleType =
  | 'counterparty'
  | 'bank_label'
  | 'expense_category'
  | 'billing_item'
  | 'payment_method'
  | 'journal';

export interface RuleRow {
  id: string;
  cabinet_id: string;
  company_id: string;
  rule_type: RuleType;
  match_key: string;
  match_label: string | null;
  account_id: string | null;
  counter_account_id: string | null;
  journal_id: string | null;
  priority: number;
  version: number;
  is_active: boolean;
  previous_version_id: string | null;
  account_side: 'debit' | 'credit';
  notes: string | null;
  use_count: number;
  created_by: string | null;
  validated_by: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface RuleView {
  id: string;
  ruleType: RuleType;
  matchKey: string;
  matchLabel: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  counterAccountId: string | null;
  counterAccountCode: string | null;
  counterAccountName: string | null;
  journalId: string | null;
  journalCode: string | null;
  priority: number;
  version: number;
  isActive: boolean;
  accountSide: 'debit' | 'credit';
  notes: string | null;
  useCount: number;
  createdBy: string | null;
  validatedBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const RULE_TYPES: RuleType[] = [
  'counterparty',
  'bank_label',
  'expense_category',
  'billing_item',
  'payment_method',
  'journal',
];

function view(row: any): RuleView {
  return {
    id: row.id,
    ruleType: row.rule_type,
    matchKey: row.match_key,
    matchLabel: row.match_label,
    accountId: row.account_id,
    accountCode: row.account_code ?? null,
    accountName: row.account_name ?? null,
    counterAccountId: row.counter_account_id,
    counterAccountCode: row.counter_account_code ?? null,
    counterAccountName: row.counter_account_name ?? null,
    journalId: row.journal_id,
    journalCode: row.journal_code ?? null,
    priority: Number(row.priority),
    version: Number(row.version),
    isActive: row.is_active,
    accountSide: row.account_side,
    notes: row.notes,
    useCount: Number(row.use_count ?? 0),
    createdBy: row.created_by,
    validatedBy: row.validated_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}

export async function listRules(
  db: Db,
  cabinetId: string,
  companyId: string,
  options: { includeInactive?: boolean } = {},
): Promise<RuleView[]> {
  const res = await db.query<any>(
    `SELECT r.*, a.code AS account_code, a.name AS account_name,
            c.code AS counter_account_code, c.name AS counter_account_name,
            j.code AS journal_code
       FROM ai_rules r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN accounts c ON c.id = r.counter_account_id
       LEFT JOIN journals j ON j.id = r.journal_id
      WHERE r.cabinet_id = $1 AND r.company_id = $2
        ${options.includeInactive ? '' : 'AND r.is_active = true'}
      ORDER BY r.rule_type, r.priority, r.match_key`,
    [cabinetId, companyId],
  );
  return res.rows.map(view);
}

export async function listRuleHistory(
  db: Db,
  cabinetId: string,
  companyId: string,
  ruleType: RuleType,
  matchKey: string,
): Promise<RuleView[]> {
  const res = await db.query<any>(
    `SELECT r.*, a.code AS account_code, a.name AS account_name,
            c.code AS counter_account_code, c.name AS counter_account_name,
            j.code AS journal_code
       FROM ai_rules r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN accounts c ON c.id = r.counter_account_id
       LEFT JOIN journals j ON j.id = r.journal_id
      WHERE r.cabinet_id = $1 AND r.company_id = $2 AND r.rule_type = $3
        AND lower(btrim(r.match_key)) = lower(btrim($4))
      ORDER BY r.version DESC`,
    [cabinetId, companyId, ruleType, matchKey],
  );
  return res.rows.map(view);
}

export interface SaveRuleParams {
  cabinetId: string;
  companyId: string;
  userId: string;
  ruleType: RuleType;
  matchKey: string;
  matchLabel?: string | null;
  accountId?: string | null;
  counterAccountId?: string | null;
  journalId?: string | null;
  accountSide?: 'debit' | 'credit';
  priority?: number;
  notes?: string | null;
}

/**
 * Creates a rule version. Saving a rule with the same (company, type, key)
 * deactivates the previous active version in the same transaction, which keeps
 * the unique active index satisfiable and the history complete.
 */
export async function saveRule(db: Db, params: SaveRuleParams): Promise<RuleView> {
  if (!RULE_TYPES.includes(params.ruleType)) {
    throw badRequest('AI_RULE_INVALID', 'Unknown rule type');
  }
  const matchKey = params.matchKey.trim();
  if (matchKey.length < 2 || matchKey.length > 120) {
    throw badRequest('AI_RULE_INVALID', 'The match key must contain between 2 and 120 characters');
  }
  if (!params.accountId && !params.journalId) {
    throw badRequest('AI_RULE_INVALID', 'A rule must target at least one account or journal');
  }
  if (params.accountId) {
    const account = await db.query(
      'SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2 AND is_active = true',
      [params.accountId, params.companyId],
    );
    if (account.rowCount === 0) {
      throw badRequest('AI_ACCOUNT_NOT_IN_CHART', 'The account does not belong to this company');
    }
  }
  if (params.counterAccountId) {
    const account = await db.query(
      'SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2 AND is_active = true',
      [params.counterAccountId, params.companyId],
    );
    if (account.rowCount === 0) {
      throw badRequest('AI_ACCOUNT_NOT_IN_CHART', 'The counter account does not belong to this company');
    }
  }
  if (params.journalId) {
    const journal = await db.query(
      'SELECT 1 FROM journals WHERE id = $1 AND company_id = $2 AND is_active = true',
      [params.journalId, params.companyId],
    );
    if (journal.rowCount === 0) throw badRequest('VALIDATION_ERROR', 'The journal does not belong to this company');
  }

  const saved = await db.transaction(async (tx) => {
    const previous = await tx.query<RuleRow>(
      `SELECT * FROM ai_rules
        WHERE cabinet_id = $1 AND company_id = $2 AND rule_type = $3
          AND lower(btrim(match_key)) = lower(btrim($4)) AND is_active = true
        FOR UPDATE`,
      [params.cabinetId, params.companyId, params.ruleType, matchKey],
    );
    const previousRow = previous.rows[0] ?? null;
    if (previousRow) {
      await tx.query('UPDATE ai_rules SET is_active = false, updated_at = now() WHERE id = $1', [
        previousRow.id,
      ]);
    }
    const inserted = await tx.query<any>(
      `INSERT INTO ai_rules
         (cabinet_id, company_id, rule_type, match_key, match_label, account_id, counter_account_id,
          journal_id, account_side, priority, version, is_active, previous_version_id, notes,
          created_by, validated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15)
       RETURNING id`,
      [
        params.cabinetId,
        params.companyId,
        params.ruleType,
        matchKey,
        params.matchLabel ?? null,
        params.accountId ?? null,
        params.counterAccountId ?? null,
        params.journalId ?? null,
        params.accountSide ?? 'debit',
        params.priority ?? 100,
        (previousRow?.version ?? 0) + 1,
        previousRow?.id ?? null,
        params.notes ?? null,
        params.userId,
        params.userId,
      ],
    );
    const id = (inserted.rows[0] as { id: string }).id;
    await writeAudit(tx, {
      companyId: params.companyId,
      userId: params.userId,
      action: 'ai.rule.save',
      entityType: 'ai_rule',
      entityId: id,
      details: {
        ruleType: params.ruleType,
        matchKey,
        version: (previousRow?.version ?? 0) + 1,
        previousVersionId: previousRow?.id ?? null,
      },
    });
    const loaded = await tx.query<any>(
      `SELECT r.*, a.code AS account_code, a.name AS account_name,
              c.code AS counter_account_code, c.name AS counter_account_name,
              j.code AS journal_code
         FROM ai_rules r
         LEFT JOIN accounts a ON a.id = r.account_id
         LEFT JOIN accounts c ON c.id = r.counter_account_id
         LEFT JOIN journals j ON j.id = r.journal_id
        WHERE r.id = $1`,
      [id],
    );
    return loaded.rows[0];
  });

  return view(saved);
}

export async function disableRule(
  db: Db,
  cabinetId: string,
  companyId: string,
  ruleId: string,
  userId: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE ai_rules SET is_active = false, updated_at = now()
      WHERE id = $1 AND cabinet_id = $2 AND company_id = $3 AND is_active = true`,
    [ruleId, cabinetId, companyId],
  );
  if (res.rowCount > 0) {
    await writeAudit(db, {
      companyId,
      userId,
      action: 'ai.rule.disable',
      entityType: 'ai_rule',
      entityId: ruleId,
      details: { cabinetId },
    });
  }
  return res.rowCount > 0;
}

export interface RuleMatch {
  rule: {
    id: string;
    type: RuleType;
    key: string;
    label: string | null;
    version: number;
    priority: number;
  };
  accountId: string | null;
  accountSide: 'debit' | 'credit';
  counterAccountId: string | null;
  journalId: string | null;
  explanation: string;
}

export interface RuleMatchResult {
  applied: RuleMatch | null;
  candidates: RuleMatch[];
  ambiguous: boolean;
  /** Human-readable trace of what was searched and why nothing was applied. */
  trace: string[];
}

/**
 * Finds the rules whose key appears in the text. Exactly one unambiguous match
 * may be applied; competing matches with the same priority are reported.
 */
export async function matchRules(
  db: Db,
  cabinetId: string,
  companyId: string,
  text: string,
): Promise<RuleMatchResult> {
  const haystack = normalise(text);
  const res = await db.query<any>(
    `SELECT r.*, a.code AS account_code, a.name AS account_name,
            j.code AS journal_code
       FROM ai_rules r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN journals j ON j.id = r.journal_id
      WHERE r.cabinet_id = $1 AND r.company_id = $2 AND r.is_active = true
      ORDER BY r.priority ASC, length(r.match_key) DESC`,
    [cabinetId, companyId],
  );

  const trace: string[] = [];
  const candidates: RuleMatch[] = [];
  for (const row of res.rows) {
    const key = normalise(row.match_key);
    if (key.length < 2 || !haystack.includes(key)) continue;
    const match: RuleMatch = {
      rule: {
        id: row.id,
        type: row.rule_type,
        key: row.match_key,
        label: row.match_label,
        version: Number(row.version),
        priority: Number(row.priority),
      },
      accountId: row.account_id,
      accountSide: row.account_side,
      counterAccountId: row.counter_account_id,
      journalId: row.journal_id,
      explanation:
        `Règle ${row.rule_type} v${row.version} « ${row.match_key} » ` +
        `(priorité ${row.priority}) → ${row.account_code ?? 'journal ' + (row.journal_code ?? '')}`,
    };
    candidates.push(match);
  }

  if (candidates.length === 0) {
    trace.push('Aucune règle validée ne correspond à ce libellé.');
    return { applied: null, candidates, ambiguous: false, trace };
  }

  const best = candidates[0]!;
  const competing = candidates.filter(
    (c) => c !== best && c.rule.priority === best.rule.priority && c.accountId !== best.accountId,
  );
  if (competing.length > 0) {
    trace.push(
      'Conflit : plusieurs règles de même priorité proposent des comptes différents. ' +
        'Aucune règle n’est appliquée automatiquement.',
    );
    return { applied: null, candidates, ambiguous: true, trace };
  }

  trace.push(best.explanation);
  return { applied: best, candidates, ambiguous: false, trace };
}

/** Increments usage counters after a rule actually shaped a proposal. */
export async function markRuleUsed(db: Db, ruleId: string): Promise<void> {
  await db.query('UPDATE ai_rules SET use_count = use_count + 1, last_used_at = now() WHERE id = $1', [
    ruleId,
  ]);
}

export async function requireRule(
  db: Db,
  cabinetId: string,
  companyId: string,
  ruleId: string,
): Promise<RuleRow> {
  const res = await db.query<RuleRow>(
    'SELECT * FROM ai_rules WHERE id = $1 AND cabinet_id = $2 AND company_id = $3',
    [ruleId, cabinetId, companyId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('AI_RULE_NOT_FOUND', 'Rule not found');
  return row;
}

export function assertRuleType(value: string): RuleType {
  if (!RULE_TYPES.includes(value as RuleType)) {
    throw badRequest('AI_RULE_INVALID', 'Unknown rule type', { allowed: RULE_TYPES });
  }
  return value as RuleType;
}

export { RULE_TYPES, conflict };
