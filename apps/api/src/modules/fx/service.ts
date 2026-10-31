/**
 * Multi-currency service (mission 13).
 *
 * All amounts are exact decimals: bigint scaled by 10^4 for money and 10^8 for
 * rates. A rate is only usable after an explicit human validation of the exact
 * currency pair and date. There is no fallback to the last known rate and no
 * automatic inverse derivation. Realized differences are proposals; latent
 * revaluations are simulations whose posting is deliberately blocked until the
 * Mauritian accounting treatment is validated by a professional.
 */
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import {
  formatAmount,
  formatScaled,
  multiply,
  parseAmount,
  parseRate,
  reciprocal,
} from '../../lib/money.js';
import { writeAudit } from '../../lib/audit.js';
import { assertOpenPeriod } from '../entries/service.js';
import { postEntryTx } from '../../lib/posting.js';
import { SUPPORTED_CURRENCIES } from '../../types.js';

export const FX_CURRENCIES = SUPPORTED_CURRENCIES;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type FxSourceKind = 'manual' | 'imported' | 'demo';
export type FxDirection = 'gain' | 'loss';
export type FxSide = 'customer' | 'supplier';

export interface FxRateRow {
  id: string;
  company_id: string;
  base_currency: string;
  quote_currency: string;
  rate_date: string;
  rate: string;
  source_kind: FxSourceKind;
  source: string;
  reference: string | null;
  status: 'draft' | 'validated' | 'rejected' | 'superseded';
  version: number;
  supersedes_id: string | null;
  created_by: string | null;
  created_at: string;
  validated_by: string | null;
  validated_at: string | null;
  validation_note: string | null;
}

export interface FxSettingsRow {
  company_id: string;
  functional_locked: boolean;
  functional_locked_at: string | null;
  functional_locked_by: string | null;
  rate_policy: 'validated_only';
  fx_gain_account_id: string | null;
  fx_loss_account_id: string | null;
  valuation_enabled: boolean;
  valuation_posting: boolean;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface FxAdjustmentRow {
  id: string;
  cabinet_id: string;
  company_id: string;
  side: FxSide;
  source_type: 'billing' | 'purchase';
  invoice_id: string;
  payment_id: string;
  invoice_no: string | null;
  payment_no: string | null;
  partner_name: string | null;
  currency: string;
  invoice_rate: string;
  settlement_rate: string;
  settled_txn_amount: string;
  invoice_functional: string;
  settlement_functional: string;
  difference: string;
  direction: FxDirection;
  status: 'proposed' | 'posted' | 'rejected';
  entry_id: string | null;
  rationale: string | null;
  created_by: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

function currency(value: string, field = 'currency'): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!CURRENCY_RE.test(code)) throw badRequest('INVALID_CURRENCY', `${field} must be ISO 4217`);
  if (!(FX_CURRENCIES as readonly string[]).includes(code)) {
    throw badRequest('UNSUPPORTED_CURRENCY', `${code} is not enabled in this release`);
  }
  return code;
}

function isoDate(value: string, field = 'date'): string {
  const raw = String(value ?? '').slice(0, 10);
  if (!DATE_RE.test(raw)) throw badRequest('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`);
  return raw;
}

function rateString(value: string | number): string {
  let raw = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) {
    throw badRequest('FX_RATE_INVALID', 'Rate must be a positive decimal with at most 8 decimals');
  }
  let scaled: bigint;
  try {
    scaled = parseRate(raw);
  } catch {
    throw badRequest('FX_RATE_INVALID', 'Rate must be a positive decimal');
  }
  if (scaled <= 0n) throw badRequest('FX_RATE_INVALID', 'Rate must be strictly positive');
  // Normalise to 8 decimals without using floating point.
  raw = formatScaled(scaled, 8);
  return raw;
}

async function companyCabinet(db: Db, companyId: string): Promise<string> {
  const res = await db.query<{ cabinet_id: string }>(
    'SELECT cabinet_id FROM companies WHERE id = $1',
    [companyId],
  );
  if (!res.rows[0]?.cabinet_id) throw conflict('CABINET_NOT_FOUND', 'Company has no cabinet');
  return res.rows[0].cabinet_id;
}

export async function ensureFxSettings(db: Db, companyId: string): Promise<FxSettingsRow> {
  await db.query(
    `INSERT INTO company_currencies (company_id, currency)
     SELECT id, functional_currency FROM companies WHERE id = $1
     ON CONFLICT (company_id, currency) DO NOTHING`,
    [companyId],
  );
  await db.query(
    `INSERT INTO fx_settings (company_id, functional_locked, functional_locked_at)
     SELECT c.id,
            EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id = c.id AND e.status = 'posted'),
            CASE WHEN EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id = c.id AND e.status = 'posted')
                 THEN now() ELSE NULL END
       FROM companies c WHERE c.id = $1
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId],
  );
  const res = await db.query<FxSettingsRow>('SELECT * FROM fx_settings WHERE company_id = $1', [companyId]);
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0];
}

export async function getFxConfiguration(db: Db, companyId: string) {
  const settings = await ensureFxSettings(db, companyId);
  const company = await db.query<{ functional_currency: string; name: string }>(
    'SELECT functional_currency, name FROM companies WHERE id = $1',
    [companyId],
  );
  if (!company.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  const allowed = await db.query<{ currency: string; is_allowed: boolean }>(
    'SELECT currency, is_allowed FROM company_currencies WHERE company_id = $1 ORDER BY currency',
    [companyId],
  );
  const accounts = await db.query<{ id: string; code: string; name: string; type: string }>(
    `SELECT id, code, name, type FROM accounts
      WHERE company_id = $1 AND is_active = true AND type IN ('revenue', 'expense')
      ORDER BY code`,
    [companyId],
  );
  return {
    functionalCurrency: company.rows[0].functional_currency,
    companyName: company.rows[0].name,
    functionalLocked: settings.functional_locked,
    functionalLockedAt: settings.functional_locked_at,
    ratePolicy: settings.rate_policy,
    fxGainAccountId: settings.fx_gain_account_id,
    fxLossAccountId: settings.fx_loss_account_id,
    valuationEnabled: settings.valuation_enabled,
    valuationPosting: false,
    notes: settings.notes,
    allowedCurrencies: allowed.rows,
    accounts: accounts.rows,
    supportedCurrencies: FX_CURRENCIES,
  };
}

export async function updateFxConfiguration(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  input: {
    allowedCurrencies?: string[];
    fxGainAccountId?: string | null;
    fxLossAccountId?: string | null;
    valuationEnabled?: boolean;
    notes?: string | null;
    lockFunctional?: boolean;
  },
) {
  await ensureFxSettings(db, actor.companyId);
  return db.transaction(async (tx) => {
    const settings = await ensureFxSettings(tx, actor.companyId);
    const company = await tx.query<{ functional_currency: string }>(
      'SELECT functional_currency FROM companies WHERE id = $1',
      [actor.companyId],
    );
    const functional = company.rows[0]!.functional_currency;

    if (input.allowedCurrencies) {
      const unique = [...new Set(input.allowedCurrencies.map((c) => currency(c)))];
      if (!unique.includes(functional)) {
        throw badRequest('FX_FUNCTIONAL_NOT_ALLOWED', 'The functional currency must remain allowed');
      }
      for (const code of unique) {
        await tx.query(
          `INSERT INTO company_currencies (company_id, currency, is_allowed, created_by)
           VALUES ($1,$2,true,$3)
           ON CONFLICT (company_id, currency) DO UPDATE SET is_allowed = true, updated_at = now()`,
          [actor.companyId, code, actor.userId],
        );
      }
      const disabled = await tx.query<{ currency: string }>(
        `UPDATE company_currencies SET is_allowed = false, updated_at = now()
          WHERE company_id = $1 AND currency <> ALL($2::text[]) AND is_allowed = true
          RETURNING currency`,
        [actor.companyId, unique],
      );
      if (disabled.rowCount > 0) {
        const codes = disabled.rows.map((r) => r.currency);
        const used = await tx.query<{ currency: string }>(
          `SELECT DISTINCT currency FROM billing_documents WHERE company_id = $1 AND currency = ANY($2::text[])
           UNION
           SELECT DISTINCT currency FROM purchase_documents WHERE company_id = $1 AND currency = ANY($2::text[])
           UNION
           SELECT DISTINCT currency FROM bank_accounts WHERE company_id = $1 AND currency = ANY($2::text[])`,
          [actor.companyId, codes],
        );
        if (used.rowCount > 0) {
          throw conflict(
            'FX_CURRENCY_IN_USE',
            `Cannot disable a currency already used by documents or bank accounts: ${used.rows
              .map((r) => r.currency)
              .join(', ')}`,
          );
        }
      }
    }

    if (input.fxGainAccountId !== undefined) {
      await assertFxAccount(tx, actor.companyId, input.fxGainAccountId, 'revenue');
    }
    if (input.fxLossAccountId !== undefined) {
      await assertFxAccount(tx, actor.companyId, input.fxLossAccountId, 'expense');
    }
    if (input.lockFunctional && !settings.functional_locked) {
      await tx.query(
        `UPDATE fx_settings SET functional_locked = true, functional_locked_at = now(),
                functional_locked_by = $2, updated_by = $2, updated_at = now()
          WHERE company_id = $1`,
        [actor.companyId, actor.userId],
      );
    }
    const updated = await tx.query<FxSettingsRow>(
      `UPDATE fx_settings SET
          fx_gain_account_id = CASE WHEN $2::boolean THEN $3::uuid ELSE fx_gain_account_id END,
          fx_loss_account_id = CASE WHEN $4::boolean THEN $5::uuid ELSE fx_loss_account_id END,
          valuation_enabled = COALESCE($6::boolean, valuation_enabled),
          notes = CASE WHEN $7::boolean THEN $8 ELSE notes END,
          updated_by = $9, updated_at = now()
        WHERE company_id = $1 RETURNING *`,
      [
        actor.companyId,
        input.fxGainAccountId !== undefined,
        input.fxGainAccountId ?? null,
        input.fxLossAccountId !== undefined,
        input.fxLossAccountId ?? null,
        input.valuationEnabled ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        actor.userId,
      ],
    );
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.config.update',
      entityType: 'fx_settings',
      entityId: actor.companyId,
      details: { allowedCurrencies: input.allowedCurrencies, lockFunctional: input.lockFunctional },
      ip: actor.ip,
    });
    return updated.rows[0]!;
  });
}

async function assertFxAccount(
  db: Db,
  companyId: string,
  accountId: string | null,
  expected: 'revenue' | 'expense',
): Promise<void> {
  if (accountId === null) return;
  const account = await db.query<{ type: string; is_active: boolean }>(
    'SELECT type, is_active FROM accounts WHERE id = $1 AND company_id = $2',
    [accountId, companyId],
  );
  if (!account.rows[0]) throw notFound('ACCOUNT_NOT_FOUND', 'FX account not found in this company');
  if (!account.rows[0].is_active) throw conflict('ACCOUNT_INACTIVE', 'FX account is inactive');
  if (account.rows[0].type !== expected) {
    throw badRequest(
      'FX_ACCOUNT_INVALID',
      `The ${expected === 'revenue' ? 'gain' : 'loss'} account must be of type ${expected}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export async function listFxRates(
  db: Db,
  companyId: string,
  filters: { base?: string; quote?: string; date?: string; status?: string; limit?: number } = {},
) {
  const where = ['company_id = $1'];
  const params: unknown[] = [companyId];
  if (filters.base) {
    params.push(currency(filters.base, 'base'));
    where.push(`base_currency = $${params.length}`);
  }
  if (filters.quote) {
    params.push(currency(filters.quote, 'quote'));
    where.push(`quote_currency = $${params.length}`);
  }
  if (filters.date) {
    params.push(isoDate(filters.date));
    where.push(`rate_date = $${params.length}`);
  }
  if (filters.status) {
    if (!['draft', 'validated', 'rejected', 'superseded'].includes(filters.status)) {
      throw badRequest('VALIDATION_ERROR', 'Invalid rate status');
    }
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const res = await db.query<FxRateRow>(
    `SELECT * FROM fx_rates WHERE ${where.join(' AND ')}
      ORDER BY rate_date DESC, base_currency, quote_currency, version DESC LIMIT ${limit}`,
    params,
  );
  return res.rows;
}

export async function createFxRate(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  input: {
    baseCurrency: string;
    quoteCurrency: string;
    rateDate: string;
    rate: string | number;
    sourceKind: FxSourceKind;
    source: string;
    reference?: string | null;
  },
): Promise<FxRateRow> {
  const base = currency(input.baseCurrency, 'baseCurrency');
  const quote = currency(input.quoteCurrency, 'quoteCurrency');
  if (base === quote) throw badRequest('FX_RATE_INVALID', 'Base and quote currencies must differ');
  const date = isoDate(input.rateDate, 'rateDate');
  const value = rateString(input.rate);
  if (!['manual', 'imported', 'demo'].includes(input.sourceKind)) {
    throw badRequest('FX_RATE_SOURCE_INVALID', 'sourceKind must be manual, imported or demo');
  }
  const source = String(input.source ?? '').trim();
  if (!source) throw badRequest('FX_RATE_SOURCE_REQUIRED', 'A documented source is required');
  if (input.sourceKind === 'imported' && !String(input.reference ?? '').trim()) {
    throw badRequest('FX_RATE_REFERENCE_REQUIRED', 'An imported rate must quote its reference');
  }
  await ensureFxSettings(db, actor.companyId);
  const allowed = await db.query<{ currency: string }>(
    'SELECT currency FROM company_currencies WHERE company_id = $1 AND is_allowed = true AND currency = ANY($2::text[])',
    [actor.companyId, [base, quote]],
  );
  if (allowed.rowCount < 2) {
    throw conflict('FX_CURRENCY_NOT_ALLOWED', 'Both currencies must be enabled for this company');
  }
  return db.transaction(async (tx) => {
    const version = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM fx_rates
        WHERE company_id = $1 AND base_currency = $2 AND quote_currency = $3 AND rate_date = $4`,
      [actor.companyId, base, quote, date],
    );
    const previous = await tx.query<{ id: string }>(
      `SELECT id FROM fx_rates WHERE company_id = $1 AND base_currency = $2 AND quote_currency = $3
          AND rate_date = $4 AND status = 'validated' LIMIT 1`,
      [actor.companyId, base, quote, date],
    );
    const inserted = await tx.query<FxRateRow>(
      `INSERT INTO fx_rates
         (company_id, base_currency, quote_currency, rate_date, rate, source_kind, source,
          reference, status, version, supersedes_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11)
       RETURNING *`,
      [
        actor.companyId,
        base,
        quote,
        date,
        value,
        input.sourceKind,
        source,
        input.reference?.trim() || null,
        version.rows[0]!.next,
        previous.rows[0]?.id ?? null,
        actor.userId,
      ],
    );
    const row = inserted.rows[0]!;
    await tx.query(
      `INSERT INTO fx_rate_events (company_id, rate_id, action, actor_id, snapshot)
       VALUES ($1,$2,'created',$3,$4::jsonb)`,
      [actor.companyId, row.id, actor.userId, JSON.stringify(row)],
    );
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.rate.create',
      entityType: 'fx_rate',
      entityId: row.id,
      details: { pair: `${base}/${quote}`, date, rate: value, sourceKind: input.sourceKind },
      ip: actor.ip,
    });
    return row;
  });
}

export async function validateFxRate(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  rateId: string,
  input: { note?: string | null; supersede?: boolean } = {},
): Promise<FxRateRow> {
  return db.transaction(async (tx) => {
    const res = await tx.query<FxRateRow>(
      'SELECT * FROM fx_rates WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [rateId, actor.companyId],
    );
    const row = res.rows[0];
    if (!row) throw notFound('FX_RATE_NOT_FOUND', 'Rate not found');
    if (row.status === 'validated') return row;
    if (row.status !== 'draft') throw conflict('FX_RATE_CLOSED', 'This rate is already closed');
    const existing = await tx.query<{ id: string; version: number }>(
      `SELECT id, version FROM fx_rates
        WHERE company_id = $1 AND base_currency = $2 AND quote_currency = $3
          AND rate_date = $4 AND status = 'validated' AND id <> $5 FOR UPDATE`,
      [actor.companyId, row.base_currency, row.quote_currency, row.rate_date, row.id],
    );
    if (existing.rows[0]) {
      if (!input.supersede) {
        throw conflict(
          'FX_RATE_ALREADY_VALIDATED',
          'Another rate is already validated for this pair and date; create a new version and explicitly supersede it',
        );
      }
      await tx.query(`UPDATE fx_rates SET status = 'superseded' WHERE id = $1`, [existing.rows[0].id]);
      await tx.query(
        `INSERT INTO fx_rate_events (company_id, rate_id, action, actor_id, reason)
         VALUES ($1,$2,'superseded',$3,$4)`,
        [actor.companyId, existing.rows[0].id, actor.userId, input.note ?? null],
      );
    }
    const updated = await tx.query<FxRateRow>(
      `UPDATE fx_rates SET status = 'validated', validated_by = $2, validated_at = now(),
              validation_note = $3
        WHERE id = $1 RETURNING *`,
      [row.id, actor.userId, input.note?.trim() || null],
    );
    const validated = updated.rows[0]!;
    await tx.query(
      `INSERT INTO fx_rate_events (company_id, rate_id, action, actor_id, reason, snapshot)
       VALUES ($1,$2,'validated',$3,$4,$5::jsonb)`,
      [actor.companyId, row.id, actor.userId, input.note ?? null, JSON.stringify(validated)],
    );
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.rate.validate',
      entityType: 'fx_rate',
      entityId: row.id,
      details: { pair: `${row.base_currency}/${row.quote_currency}`, date: row.rate_date, rate: row.rate },
      ip: actor.ip,
    });
    return validated;
  });
}

export async function rejectFxRate(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  rateId: string,
  reason: string,
): Promise<FxRateRow> {
  if (!reason?.trim()) throw badRequest('FX_RATE_REASON_REQUIRED', 'A rejection reason is required');
  return db.transaction(async (tx) => {
    const res = await tx.query<FxRateRow>(
      'SELECT * FROM fx_rates WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [rateId, actor.companyId],
    );
    const row = res.rows[0];
    if (!row) throw notFound('FX_RATE_NOT_FOUND', 'Rate not found');
    if (row.status !== 'draft') throw conflict('FX_RATE_CLOSED', 'Only a draft rate can be rejected');
    const updated = await tx.query<FxRateRow>(
      `UPDATE fx_rates SET status = 'rejected', validated_by = $2, validated_at = now(),
              validation_note = $3
        WHERE id = $1 RETURNING *`,
      [row.id, actor.userId, reason.trim()],
    );
    await tx.query(
      `INSERT INTO fx_rate_events (company_id, rate_id, action, actor_id, reason)
       VALUES ($1,$2,'rejected',$3,$4)`,
      [actor.companyId, row.id, actor.userId, reason.trim()],
    );
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.rate.reject',
      entityType: 'fx_rate',
      entityId: row.id,
      details: { reason: reason.trim() },
      ip: actor.ip,
    });
    return updated.rows[0]!;
  });
}

/**
 * Resolves exactly one validated row for the pair and date. A draft, missing,
 * superseded or reversed pair is never silently replaced by another rate.
 */
export async function resolveFxRate(
  db: Db,
  companyId: string,
  baseInput: string,
  quoteInput: string,
  dateInput: string,
): Promise<{ rate: string; row: FxRateRow | null; identity: boolean }> {
  const base = currency(baseInput, 'from');
  const quote = currency(quoteInput, 'to');
  const date = isoDate(dateInput, 'date');
  if (base === quote) return { rate: '1.00000000', row: null, identity: true };
  const validated = await db.query<FxRateRow>(
    `SELECT * FROM fx_rates WHERE company_id = $1 AND base_currency = $2 AND quote_currency = $3
        AND rate_date = $4 AND status = 'validated' LIMIT 1`,
    [companyId, base, quote, date],
  );
  if (validated.rows[0]) return { rate: validated.rows[0].rate, row: validated.rows[0], identity: false };
  const draft = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM fx_rates WHERE company_id = $1 AND base_currency = $2
        AND quote_currency = $3 AND rate_date = $4 ORDER BY version DESC LIMIT 1`,
    [companyId, base, quote, date],
  );
  if (draft.rows[0]) {
    throw conflict(
      'FX_RATE_NOT_VALIDATED',
      `A ${base}/${quote} rate exists for ${date} but is ${draft.rows[0].status}; human validation is required`,
      { rateId: draft.rows[0].id },
    );
  }
  const inverse = await db.query<{ id: string }>(
    `SELECT id FROM fx_rates WHERE company_id = $1 AND base_currency = $2 AND quote_currency = $3
        AND rate_date = $4 AND status = 'validated' LIMIT 1`,
    [companyId, quote, base, date],
  );
  if (inverse.rows[0]) {
    throw conflict(
      'FX_RATE_DIRECTION_MISMATCH',
      `Only the inverse ${quote}/${base} rate is validated for ${date}; the ${base}/${quote} direction must be validated explicitly`,
      { inverseRateId: inverse.rows[0].id },
    );
  }
  throw conflict('FX_RATE_MISSING', `No validated ${base}/${quote} rate for ${date}`, {
    base,
    quote,
    date,
  });
}

export function convertExact(amount: string | number, rate: string): string {
  const parsed = parseAmount(amount);
  if (parsed < 0n) throw badRequest('FX_AMOUNT_INVALID', 'Amount must be positive');
  return formatAmount(multiply(parsed, rate));
}

export async function explainConversion(
  db: Db,
  companyId: string,
  input: { amount: string | number; from: string; to: string; date: string },
) {
  const resolved = await resolveFxRate(db, companyId, input.from, input.to, input.date);
  const converted = convertExact(input.amount, resolved.rate);
  return {
    amount: formatAmount(parseAmount(input.amount)),
    from: input.from.toUpperCase(),
    to: input.to.toUpperCase(),
    date: isoDate(input.date),
    rate: resolved.rate,
    converted,
    inverseRate: resolved.identity ? '1.00000000' : reciprocal(resolved.rate),
    rateId: resolved.row?.id ?? null,
    source: resolved.row?.source ?? (resolved.identity ? 'identity' : null),
    sourceKind: resolved.row?.source_kind ?? (resolved.identity ? 'identity' : null),
    official: false as const,
    note:
      'Taux saisi et validé pour cette société. Il n’est ni officiel ni fourni par une banque centrale dans cette version.',
  };
}

// ---------------------------------------------------------------------------
// Realized exchange differences
// ---------------------------------------------------------------------------

interface RealizedSourceRow {
  source_type: 'billing' | 'purchase';
  invoice_id: string;
  invoice_no: string | null;
  partner_name: string | null;
  payment_id: string;
  payment_no: string | null;
  payment_date: string;
  currency: string;
  invoice_rate: string;
  settlement_rate: string;
  settled_txn_amount: string;
}

async function functionalCurrency(db: Db, companyId: string): Promise<string> {
  const res = await db.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id = $1',
    [companyId],
  );
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0].functional_currency;
}

export async function scanRealizedAdjustments(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
) {
  const functional = await functionalCurrency(db, actor.companyId);
  const cabinetId = await companyCabinet(db, actor.companyId);
  const sources = await db.query<RealizedSourceRow>(
    `SELECT 'billing'::text AS source_type,
            d.id AS invoice_id, d.doc_no AS invoice_no, d.customer_name AS partner_name,
            p.id AS payment_id, p.payment_no, p.payment_date::text,
            p.currency, d.exchange_rate::text AS invoice_rate,
            p.exchange_rate::text AS settlement_rate, a.amount::text AS settled_txn_amount
       FROM billing_payment_allocations a
       JOIN billing_payments p ON p.id = a.payment_id AND p.company_id = a.company_id
       JOIN billing_documents d ON d.id = a.invoice_id AND d.company_id = a.company_id
      WHERE p.company_id = $1 AND p.status = 'recorded'
        AND p.accounting_entry_id IS NOT NULL AND d.accounting_entry_id IS NOT NULL
        AND p.currency = d.currency AND p.currency <> $2
        AND p.exchange_rate <> d.exchange_rate
     UNION ALL
     SELECT 'purchase'::text AS source_type,
            d.id AS invoice_id, d.doc_no AS invoice_no, s.name AS partner_name,
            p.id AS payment_id, p.payment_no, p.payment_date::text,
            p.currency, d.exchange_rate::text AS invoice_rate,
            p.exchange_rate::text AS settlement_rate, a.amount::text AS settled_txn_amount
       FROM purchase_payment_allocations a
       JOIN purchase_payments p ON p.id = a.payment_id AND p.company_id = a.company_id
       JOIN purchase_documents d ON d.id = a.invoice_id AND d.company_id = a.company_id
       JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
      WHERE p.company_id = $1 AND p.status = 'recorded' AND a.cancelled_at IS NULL
        AND p.accounting_entry_id IS NOT NULL AND d.accounting_entry_id IS NOT NULL
        AND p.currency = d.currency AND p.currency <> $2
        AND p.exchange_rate <> d.exchange_rate
      ORDER BY payment_date, payment_no`,
    [actor.companyId, functional],
  );

  let created = 0;
  for (const source of sources.rows) {
    const settled = parseAmount(source.settled_txn_amount);
    const invoiceFunctional = multiply(settled, source.invoice_rate);
    const settlementFunctional = multiply(settled, source.settlement_rate);
    const difference = settlementFunctional > invoiceFunctional
      ? settlementFunctional - invoiceFunctional
      : invoiceFunctional - settlementFunctional;
    if (difference === 0n) continue;
    const side: FxSide = source.source_type === 'billing' ? 'customer' : 'supplier';
    const paidMore = settlementFunctional > invoiceFunctional;
    const direction: FxDirection =
      side === 'customer' ? (paidMore ? 'gain' : 'loss') : (paidMore ? 'loss' : 'gain');
    const inserted = await db.query(
      `INSERT INTO fx_realized_adjustments
         (cabinet_id, company_id, side, source_type, invoice_id, payment_id, invoice_no,
          payment_no, partner_name, currency, invoice_rate, settlement_rate,
          settled_txn_amount, invoice_functional, settlement_functional, difference,
          direction, rationale, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (company_id, source_type, payment_id, invoice_id) DO NOTHING
       RETURNING id`,
      [
        cabinetId,
        actor.companyId,
        side,
        source.source_type,
        source.invoice_id,
        source.payment_id,
        source.invoice_no,
        source.payment_no,
        source.partner_name,
        source.currency,
        source.invoice_rate,
        source.settlement_rate,
        formatAmount(settled),
        formatAmount(invoiceFunctional),
        formatAmount(settlementFunctional),
        formatAmount(difference),
        direction,
        `Écart réalisé : ${formatAmount(settled)} ${source.currency} × (${source.settlement_rate} − ${source.invoice_rate}) = ${formatAmount(difference)} ${functional}.`,
        actor.userId,
      ],
    );
    if (inserted.rowCount > 0) created += 1;
  }
  const rows = await listRealizedAdjustments(db, actor.companyId);
  if (created > 0) {
    await writeAudit(db, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.realized.scan',
      entityType: 'fx_realized_adjustment',
      details: { created, total: rows.length, functional },
      ip: actor.ip,
    });
  }
  return { created, adjustments: rows };
}

export async function listRealizedAdjustments(
  db: Db,
  companyId: string,
  filters: { status?: string; currency?: string; limit?: number } = {},
) {
  const where = ['company_id = $1'];
  const params: unknown[] = [companyId];
  if (filters.status) {
    if (!['proposed', 'posted', 'rejected'].includes(filters.status)) {
      throw badRequest('VALIDATION_ERROR', 'Invalid realized status');
    }
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.currency) {
    params.push(currency(filters.currency));
    where.push(`currency = $${params.length}`);
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const res = await db.query<FxAdjustmentRow>(
    `SELECT * FROM fx_realized_adjustments WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  return res.rows;
}

async function partnerAccount(
  db: Db,
  companyId: string,
  adjustment: FxAdjustmentRow,
): Promise<{ id: string; code: string }> {
  if (adjustment.side === 'customer') {
    const custom = await db.query<{ id: string; code: string }>(
      `SELECT a.id, a.code FROM billing_documents d
         JOIN billing_customers c ON c.id = d.customer_id AND c.company_id = d.company_id
         JOIN accounts a ON a.id = c.receivable_account_id AND a.company_id = c.company_id
        WHERE d.id = $1 AND d.company_id = $2`,
      [adjustment.invoice_id, companyId],
    );
    if (custom.rows[0]) return custom.rows[0];
    const fallback = await db.query<{ id: string; code: string }>(
      `SELECT id, code FROM accounts WHERE company_id = $1 AND code = '1100' AND is_active = true`,
      [companyId],
    );
    if (fallback.rows[0]) return fallback.rows[0];
    throw conflict('FX_ACCOUNTS_NOT_CONFIGURED', 'No active customer receivable account is configured');
  }
  const custom = await db.query<{ id: string; code: string }>(
    `SELECT a.id, a.code FROM purchase_documents d
       JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
       JOIN accounts a ON a.id = s.payable_account_id AND a.company_id = s.company_id
      WHERE d.id = $1 AND d.company_id = $2`,
    [adjustment.invoice_id, companyId],
  );
  if (custom.rows[0]) return custom.rows[0];
  const fallback = await db.query<{ id: string; code: string }>(
    `SELECT id, code FROM accounts WHERE company_id = $1 AND code = '2000' AND is_active = true`,
    [companyId],
  );
  if (fallback.rows[0]) return fallback.rows[0];
  throw conflict('FX_ACCOUNTS_NOT_CONFIGURED', 'No active supplier payable account is configured');
}

async function adjustmentPaymentDate(
  db: Db,
  adjustment: FxAdjustmentRow,
): Promise<string> {
  const table = adjustment.source_type === 'billing' ? 'billing_payments' : 'purchase_payments';
  const res = await db.query<{ payment_date: string }>(
    `SELECT payment_date::text FROM ${table} WHERE id = $1 AND company_id = $2`,
    [adjustment.payment_id, adjustment.company_id],
  );
  return res.rows[0]?.payment_date ?? new Date().toISOString().slice(0, 10);
}

export async function postRealizedAdjustment(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  adjustmentId: string,
  confirm: boolean,
) {
  if (!confirm) throw badRequest('FX_REALIZED_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required');
  const result = await db.transaction(async (tx) => {
    const locked = await tx.query<FxAdjustmentRow>(
      'SELECT * FROM fx_realized_adjustments WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [adjustmentId, actor.companyId],
    );
    const adjustment = locked.rows[0];
    if (!adjustment) throw notFound('FX_REALIZED_NOT_FOUND', 'Adjustment not found');
    if (adjustment.status === 'posted') {
      return { adjustment, reused: true, entry: null };
    }
    if (adjustment.status !== 'proposed') {
      throw conflict('FX_REALIZED_DECIDED', 'This adjustment is already decided');
    }
    const settings = await ensureFxSettings(tx, actor.companyId);
    const gainAccount = settings.fx_gain_account_id;
    const lossAccount = settings.fx_loss_account_id;
    if (adjustment.direction === 'gain' && !gainAccount) {
      throw conflict(
        'FX_ACCOUNTS_NOT_CONFIGURED',
        'No exchange-gain account is configured; the entry cannot be proposed or posted',
        { account: 'fx_gain_account_id' },
      );
    }
    if (adjustment.direction === 'loss' && !lossAccount) {
      throw conflict(
        'FX_ACCOUNTS_NOT_CONFIGURED',
        'No exchange-loss account is configured; the entry cannot be proposed or posted',
        { account: 'fx_loss_account_id' },
      );
    }
    const partner = await partnerAccount(tx, actor.companyId, adjustment);
    const amount = parseAmount(adjustment.difference);
    const lines: { accountId: string; description?: string | null; debit?: string; credit?: string }[] = [];
    if (adjustment.direction === 'gain') {
      if (adjustment.side === 'customer') {
        lines.push({ accountId: partner.id, description: 'Écart de change réalisé (client)', debit: formatAmount(amount) });
      } else {
        lines.push({ accountId: partner.id, description: 'Écart de change réalisé (fournisseur)', debit: formatAmount(amount) });
      }
      lines.push({
        accountId: gainAccount!,
        description: 'Gain de change réalisé',
        credit: formatAmount(amount),
      });
    } else {
      lines.push({
        accountId: lossAccount!,
        description: 'Perte de change réalisée',
        debit: formatAmount(amount),
      });
      lines.push({
        accountId: partner.id,
        description: 'Écart de change réalisé',
        credit: formatAmount(amount),
      });
    }
    const journal = await tx.query<{ id: string }>(
      `SELECT id FROM journals WHERE company_id = $1 AND is_active = true
        ORDER BY CASE WHEN type = 'general' THEN 0 ELSE 1 END, code LIMIT 1`,
      [actor.companyId],
    );
    if (!journal.rows[0]) throw conflict('JOURNAL_NOT_FOUND', 'No active journal for the FX entry');
    const functional = await functionalCurrency(tx, actor.companyId);
    const date = await adjustmentPaymentDate(tx, adjustment);
    await assertOpenPeriod(tx, actor.companyId, date);
    const posted = await postEntryTx(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      journalId: journal.rows[0].id,
      entryDate: date,
      reference: adjustment.payment_no,
      description: `Écart de change réalisé ${adjustment.invoice_no ?? ''} / ${adjustment.payment_no ?? ''} (${
        adjustment.direction === 'gain' ? 'gain' : 'perte'
      })`,
      currency: functional,
      exchangeRate: 1,
      source: 'fx',
      status: 'posted',
      lines,
    });
    const updated = await tx.query<FxAdjustmentRow>(
      `UPDATE fx_realized_adjustments SET status = 'posted', entry_id = $2,
              decided_by = $3, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [adjustment.id, posted.entry.id, actor.userId],
    );
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.realized.post',
      entityType: 'fx_realized_adjustment',
      entityId: adjustment.id,
      details: {
        entryId: posted.entry.id,
        amount: adjustment.difference,
        direction: adjustment.direction,
        invoiceRate: adjustment.invoice_rate,
        settlementRate: adjustment.settlement_rate,
      },
      ip: actor.ip,
    });
    return { adjustment: updated.rows[0]!, reused: false, entry: posted.entry };
  });
  return result;
}

export async function rejectRealizedAdjustment(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  adjustmentId: string,
  reason: string,
) {
  if (!reason?.trim()) throw badRequest('VALIDATION_ERROR', 'A rejection reason is required');
  return db.transaction(async (tx) => {
    const res = await tx.query<FxAdjustmentRow>(
      'SELECT * FROM fx_realized_adjustments WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [adjustmentId, actor.companyId],
    );
    const adjustment = res.rows[0];
    if (!adjustment) throw notFound('FX_REALIZED_NOT_FOUND', 'Adjustment not found');
    if (adjustment.status !== 'proposed') throw conflict('FX_REALIZED_DECIDED', 'Already decided');
    const updated = await tx.query<FxAdjustmentRow>(
      `UPDATE fx_realized_adjustments SET status = 'rejected', rationale = COALESCE(rationale, '') || $2,
              decided_by = $3, decided_at = now()
        WHERE id = $1 RETURNING *`,
      [adjustment.id, `\nMotif de rejet : ${reason.trim()}`, actor.userId],
    );
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.realized.reject',
      entityType: 'fx_realized_adjustment',
      entityId: adjustment.id,
      details: { reason: reason.trim() },
      ip: actor.ip,
    });
    return updated.rows[0]!;
  });
}

// ---------------------------------------------------------------------------
// Latent revaluation (simulation only)
// ---------------------------------------------------------------------------

interface RevaluationLineInput {
  sourceType: 'billing_document' | 'purchase_document' | 'bank_account';
  sourceId: string;
  documentNo: string | null;
  partnerName: string | null;
  currency: string;
  amountTxn: bigint;
  carryingFunctional: bigint;
  valuationRate: string | null;
  revaluedFunctional: bigint | null;
  difference: bigint | null;
  direction: FxDirection | null;
  blockedReason: string | null;
}

export async function simulateRevaluation(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  input: { valuationDate: string; note?: string | null },
) {
  const date = isoDate(input.valuationDate, 'valuationDate');
  const functional = await functionalCurrency(db, actor.companyId);
  const cabinetId = await companyCabinet(db, actor.companyId);
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM fx_revaluations WHERE company_id = $1 AND valuation_date = $2',
    [actor.companyId, date],
  );
  if (existing.rows[0]) {
    return { revaluation: await getRevaluation(db, actor.companyId, existing.rows[0].id), reused: true };
  }

  const lines: RevaluationLineInput[] = [];
  const billing = await db.query<{
    id: string; doc_no: string | null; partner_name: string | null; currency: string;
    exchange_rate: string; open_txn: string; posted_adjustment: string; mismatched: number;
  }>(
    `SELECT d.id, d.doc_no, d.customer_name AS partner_name, d.currency,
            d.exchange_rate::text,
            (d.total_amount - d.amount_paid - d.credited_amount)::text AS open_txn,
            COALESCE((SELECT SUM(CASE WHEN f.direction = 'gain' THEN f.difference ELSE -f.difference END)
                        FROM fx_realized_adjustments f
                       WHERE f.company_id = d.company_id AND f.invoice_id = d.id
                         AND f.source_type = 'billing' AND f.status = 'posted'), 0)::text AS posted_adjustment,
            (SELECT COUNT(*)::int FROM billing_payment_allocations a
               JOIN billing_payments p ON p.id = a.payment_id
              WHERE a.invoice_id = d.id AND p.status = 'recorded'
                AND p.accounting_entry_id IS NOT NULL AND p.exchange_rate <> d.exchange_rate) AS mismatched
       FROM billing_documents d
      WHERE d.company_id = $1 AND d.accounting_entry_id IS NOT NULL
        AND d.status IN ('issued', 'partially_paid')
        AND d.currency <> $2
        AND d.total_amount - d.amount_paid - d.credited_amount > 0
      ORDER BY d.issue_date, d.doc_no`,
    [actor.companyId, functional],
  );
  for (const row of billing.rows) {
    const open = parseAmount(row.open_txn);
    const baseCarrying = multiply(open, row.exchange_rate) + parseAmount(row.posted_adjustment);
    let valuationRate: string | null = null;
    let blocked: string | null = null;
    if (row.mismatched > 0 && parseAmount(row.posted_adjustment) === 0n) {
      blocked = 'FX_REALIZED_NOT_POSTED: des règlements à un autre taux existent ; comptabilisez d’abord l’écart réalisé.';
    } else {
      try {
        valuationRate = (await resolveFxRate(db, actor.companyId, row.currency, functional, date)).rate;
      } catch (err) {
        blocked = err instanceof Error ? err.message : 'FX_VALUATION_RATE_MISSING';
      }
    }
    const revalued = valuationRate ? multiply(open, valuationRate) + parseAmount(row.posted_adjustment) : null;
    const difference = revalued === null ? null : revalued - baseCarrying;
    lines.push({
      sourceType: 'billing_document',
      sourceId: row.id,
      documentNo: row.doc_no,
      partnerName: row.partner_name,
      currency: row.currency,
      amountTxn: open,
      carryingFunctional: baseCarrying,
      valuationRate,
      revaluedFunctional: revalued,
      difference: difference === null ? null : (difference < 0n ? -difference : difference),
      direction: difference === null || difference === 0n ? null : difference > 0n ? 'gain' : 'loss',
      blockedReason: blocked,
    });
  }

  const purchases = await db.query<{
    id: string; doc_no: string | null; partner_name: string | null; currency: string;
    exchange_rate: string; open_txn: string; posted_adjustment: string; mismatched: number;
  }>(
    `SELECT d.id, d.doc_no, s.name AS partner_name, d.currency,
            d.exchange_rate::text,
            (d.total_amount - d.amount_paid - d.credited_amount)::text AS open_txn,
            COALESCE((SELECT SUM(CASE WHEN f.direction = 'loss' THEN f.difference ELSE -f.difference END)
                        FROM fx_realized_adjustments f
                       WHERE f.company_id = d.company_id AND f.invoice_id = d.id
                         AND f.source_type = 'purchase' AND f.status = 'posted'), 0)::text AS posted_adjustment,
            (SELECT COUNT(*)::int FROM purchase_payment_allocations a
               JOIN purchase_payments p ON p.id = a.payment_id
              WHERE a.invoice_id = d.id AND a.cancelled_at IS NULL AND p.status = 'recorded'
                AND p.accounting_entry_id IS NOT NULL AND p.exchange_rate <> d.exchange_rate) AS mismatched
       FROM purchase_documents d
       JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
      WHERE d.company_id = $1 AND d.accounting_entry_id IS NOT NULL
        AND d.status = 'validated' AND d.kind = 'invoice'
        AND d.currency <> $2
        AND d.total_amount - d.amount_paid - d.credited_amount > 0
      ORDER BY d.issue_date, d.doc_no`,
    [actor.companyId, functional],
  );
  for (const row of purchases.rows) {
    const open = parseAmount(row.open_txn);
    const baseCarrying = multiply(open, row.exchange_rate) + parseAmount(row.posted_adjustment);
    let valuationRate: string | null = null;
    let blocked: string | null = null;
    if (row.mismatched > 0 && parseAmount(row.posted_adjustment) === 0n) {
      blocked = 'FX_REALIZED_NOT_POSTED: des règlements à un autre taux existent ; comptabilisez d’abord l’écart réalisé.';
    } else {
      try {
        valuationRate = (await resolveFxRate(db, actor.companyId, row.currency, functional, date)).rate;
      } catch (err) {
        blocked = err instanceof Error ? err.message : 'FX_VALUATION_RATE_MISSING';
      }
    }
    const revalued = valuationRate ? multiply(open, valuationRate) + parseAmount(row.posted_adjustment) : null;
    const difference = revalued === null ? null : revalued - baseCarrying;
    lines.push({
      sourceType: 'purchase_document',
      sourceId: row.id,
      documentNo: row.doc_no,
      partnerName: row.partner_name,
      currency: row.currency,
      amountTxn: open,
      carryingFunctional: baseCarrying,
      valuationRate,
      revaluedFunctional: revalued,
      difference: difference === null ? null : (difference < 0n ? -difference : difference),
      direction: difference === null || difference === 0n ? null : difference > 0n ? 'loss' : 'gain',
      blockedReason: blocked,
    });
  }

  const banks = await db.query<{
    id: string; name: string; currency: string; balance: string | null; carrying: string;
  }>(
    `SELECT ba.id, ba.name, ba.currency,
            (SELECT bt.balance::text FROM bank_transactions bt
              WHERE bt.bank_account_id = ba.id AND bt.balance IS NOT NULL
              ORDER BY bt.txn_date DESC, bt.created_at DESC LIMIT 1) AS balance,
            COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l
                       WHERE l.company_id = ba.company_id AND l.account_id = ba.account_id), 0)::text AS carrying
       FROM bank_accounts ba
      WHERE ba.company_id = $1 AND ba.is_active = true AND ba.currency <> $2
      ORDER BY ba.name`,
    [actor.companyId, functional],
  );
  for (const row of banks.rows) {
    if (row.balance === null || parseAmount(row.balance) === 0n) continue;
    const balance = parseAmount(row.balance);
    let valuationRate: string | null = null;
    let blocked: string | null = null;
    try {
      valuationRate = (await resolveFxRate(db, actor.companyId, row.currency, functional, date)).rate;
    } catch (err) {
      blocked = err instanceof Error ? err.message : 'FX_VALUATION_RATE_MISSING';
    }
    const carrying = parseAmount(row.carrying);
    const revalued = valuationRate ? multiply(balance, valuationRate) : null;
    const difference = revalued === null ? null : revalued - carrying;
    lines.push({
      sourceType: 'bank_account',
      sourceId: row.id,
      documentNo: null,
      partnerName: row.name,
      currency: row.currency,
      amountTxn: balance,
      carryingFunctional: carrying,
      valuationRate,
      revaluedFunctional: revalued,
      difference: difference === null ? null : (difference < 0n ? -difference : difference),
      direction: difference === null || difference === 0n ? null : difference > 0n ? 'gain' : 'loss',
      blockedReason: blocked,
    });
  }

  const note =
    input.note?.trim() ||
    'Simulation d’évaluation latente. Aucune écriture n’est créée : le traitement comptable et fiscal mauricien reste à valider par un expert-comptable.';
  const created = await db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO fx_revaluations (cabinet_id, company_id, valuation_date, status, note, created_by)
       VALUES ($1,$2,$3,'simulated',$4,$5)
       ON CONFLICT (company_id, valuation_date) DO NOTHING RETURNING id`,
      [cabinetId, actor.companyId, date, note, actor.userId],
    );
    if (!inserted.rows[0]) {
      const found = await tx.query<{ id: string }>(
        'SELECT id FROM fx_revaluations WHERE company_id = $1 AND valuation_date = $2',
        [actor.companyId, date],
      );
      return { id: found.rows[0]!.id, reused: true };
    }
    const id = inserted.rows[0].id;
    for (const line of lines) {
      await tx.query(
        `INSERT INTO fx_revaluation_lines
           (revaluation_id, company_id, source_type, source_id, document_no, partner_name,
            currency, amount_txn, carrying_functional, valuation_rate, revalued_functional,
            difference, direction, blocked_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          actor.companyId,
          line.sourceType,
          line.sourceId,
          line.documentNo,
          line.partnerName,
          line.currency,
          formatAmount(line.amountTxn),
          formatAmount(line.carryingFunctional),
          line.valuationRate,
          line.revaluedFunctional === null ? null : formatAmount(line.revaluedFunctional),
          line.difference === null ? null : formatAmount(line.difference),
          line.direction,
          line.blockedReason,
        ],
      );
    }
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.valuation.simulate',
      entityType: 'fx_revaluation',
      entityId: id,
      details: { valuationDate: date, lines: lines.length, posting: 'blocked' },
      ip: actor.ip,
    });
    return { id, reused: false };
  });
  return {
    revaluation: await getRevaluation(db, actor.companyId, created.id),
    reused: created.reused,
  };
}

export async function getRevaluation(db: Db, companyId: string, id: string) {
  const header = await db.query<any>(
    'SELECT * FROM fx_revaluations WHERE id = $1 AND company_id = $2',
    [id, companyId],
  );
  const row = header.rows[0];
  if (!row) throw notFound('FX_VALUATION_NOT_FOUND', 'Valuation not found');
  const lines = await db.query<any>(
    'SELECT * FROM fx_revaluation_lines WHERE revaluation_id = $1 ORDER BY currency, source_type, document_no',
    [id],
  );
  const totals: Record<string, { gain: string; loss: string; blocked: number }> = {};
  for (const line of lines.rows) {
    const bucket = (totals[line.currency] ??= { gain: '0.0000', loss: '0.0000', blocked: 0 });
    if (line.blocked_reason) {
      bucket.blocked += 1;
    } else if ((line.direction === 'gain' || line.direction === 'loss') && line.difference) {
      const key: 'gain' | 'loss' = line.direction;
      const current = parseAmount(bucket[key]);
      bucket[key] = formatAmount(current + parseAmount(line.difference));
    }
  }
  return {
    ...row,
    lines: lines.rows,
    totalsByCurrency: totals,
    postingBlocked: true,
    note:
      row.note ??
      'Simulation uniquement. Aucune écriture de réévaluation ou de reprise n’est comptabilisée sans validation professionnelle.',
  };
}

export async function listRevaluations(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT r.*, (SELECT COUNT(*)::int FROM fx_revaluation_lines l WHERE l.revaluation_id = r.id) AS line_count
       FROM fx_revaluations r WHERE r.company_id = $1 ORDER BY r.valuation_date DESC LIMIT 100`,
    [companyId],
  );
  return res.rows;
}

export async function validateRevaluation(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  id: string,
  note?: string | null,
) {
  return db.transaction(async (tx) => {
    const res = await tx.query<any>(
      'SELECT * FROM fx_revaluations WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, actor.companyId],
    );
    const row = res.rows[0];
    if (!row) throw notFound('FX_VALUATION_NOT_FOUND', 'Valuation not found');
    if (row.status === 'validated') return row;
    if (row.status !== 'simulated') throw conflict('FX_VALUATION_DECIDED', 'Valuation already decided');
    const blocked = await tx.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM fx_revaluation_lines WHERE revaluation_id = $1 AND blocked_reason IS NOT NULL',
      [id],
    );
    if (blocked.rows[0]!.count > 0) {
      throw conflict('FX_VALUATION_RATE_MISSING', 'Some lines are blocked; correct them before validation');
    }
    const updated = await tx.query<any>(
      `UPDATE fx_revaluations SET status = 'validated', validated_by = $2, validated_at = now(),
              note = COALESCE($3, note) WHERE id = $1 RETURNING *`,
      [id, actor.userId, note?.trim() || null],
    );
    await writeAudit(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fx.valuation.validate',
      entityType: 'fx_revaluation',
      entityId: id,
      details: { posting: 'blocked', note: note?.trim() || null },
      ip: actor.ip,
    });
    return updated.rows[0];
  });
}

export async function postRevaluation(): Promise<never> {
  throw conflict(
    'FX_VALUATION_POSTING_BLOCKED',
    'Latent exchange differences are simulated only. No revaluation or reversal entry is posted until the Mauritian accounting and tax treatment is validated by a professional.',
  );
}

// ---------------------------------------------------------------------------
// Internal transfers between own bank accounts (simulation only)
// ---------------------------------------------------------------------------

export async function previewTransfer(
  db: Db,
  actor: { companyId: string; userId: string; ip?: string },
  input: {
    fromBankAccountId: string;
    toBankAccountId: string;
    transferDate: string;
    fromAmount: string;
    feeAmount?: string | null;
    note?: string | null;
  },
) {
  if (input.fromBankAccountId === input.toBankAccountId) {
    throw badRequest('FX_TRANSFER_ACCOUNT_MISMATCH', 'Source and destination accounts must differ');
  }
  const date = isoDate(input.transferDate);
  const accounts = await db.query<{ id: string; name: string; currency: string }>(
    `SELECT id, name, currency FROM bank_accounts
      WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_active = true`,
    [actor.companyId, [input.fromBankAccountId, input.toBankAccountId]],
  );
  if (accounts.rowCount !== 2) {
    throw notFound('BANK_ACCOUNT_NOT_FOUND', 'Both bank accounts must be active and belong to this company');
  }
  const from = accounts.rows.find((a) => a.id === input.fromBankAccountId)!;
  const to = accounts.rows.find((a) => a.id === input.toBankAccountId)!;
  const amount = parseAmount(input.fromAmount);
  if (amount <= 0n) throw badRequest('FX_AMOUNT_INVALID', 'Transfer amount must be positive');
  let rate = '1.00000000';
  if (from.currency !== to.currency) {
    rate = (await resolveFxRate(db, actor.companyId, from.currency, to.currency, date)).rate;
  }
  const toAmount = multiply(amount, rate);
  const fee = input.feeAmount ? parseAmount(input.feeAmount) : 0n;
  if (fee < 0n) throw badRequest('FX_AMOUNT_INVALID', 'Fee cannot be negative');
  const cabinetId = await companyCabinet(db, actor.companyId);
  const note =
    input.note?.trim() ||
    'Simulation de virement interne. Aucun produit, aucune charge ni écriture ne sont créés automatiquement ; les frais restent distincts.';
  const inserted = await db.query<any>(
    `INSERT INTO fx_transfers
       (cabinet_id, company_id, from_bank_account_id, to_bank_account_id, transfer_date,
        from_currency, to_currency, from_amount, to_amount, rate, fee_amount, fee_currency,
        status, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'simulated',$13,$14)
     RETURNING *`,
    [
      cabinetId,
      actor.companyId,
      from.id,
      to.id,
      date,
      from.currency,
      to.currency,
      formatAmount(amount),
      formatAmount(toAmount),
      rate,
      formatAmount(fee),
      fee > 0n ? from.currency : null,
      note,
      actor.userId,
    ],
  );
  await writeAudit(db, {
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'fx.transfer.preview',
    entityType: 'fx_transfer',
    entityId: inserted.rows[0].id,
    details: { from: from.currency, to: to.currency, amount: formatAmount(amount), rate, fee: formatAmount(fee) },
    ip: actor.ip,
  });
  return {
    transfer: inserted.rows[0],
    fromAccount: from,
    toAccount: to,
    postingBlocked: true,
    policy:
      'Aucune écriture automatique : un virement entre comptes de la même société ne crée ni produit ni charge. La différence de change et les frais doivent être validés séparément.',
  };
}

export async function listTransfers(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT t.*, f.name AS from_name, d.name AS to_name
       FROM fx_transfers t
       JOIN bank_accounts f ON f.id = t.from_bank_account_id
       JOIN bank_accounts d ON d.id = t.to_bank_account_id
      WHERE t.company_id = $1 ORDER BY t.transfer_date DESC, t.created_at DESC LIMIT 100`,
    [companyId],
  );
  return res.rows;
}

export async function postTransfer(): Promise<never> {
  throw conflict(
    'FX_TRANSFER_POSTING_BLOCKED',
    'Internal transfers are simulated only. Posting requires an explicit accounting policy for exchange differences and bank fees, not yet validated.',
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function fxReport(
  db: Db,
  companyId: string,
  filters: { valuationDate?: string; currency?: string } = {},
) {
  const functional = await functionalCurrency(db, companyId);
  const currencyFilter = filters.currency ? currency(filters.currency) : null;
  const valuationDate = filters.valuationDate
    ? isoDate(filters.valuationDate, 'valuationDate')
    : new Date().toISOString().slice(0, 10);

  const receivable = await db.query<any>(
    `SELECT d.currency,
            SUM(d.total_amount - d.amount_paid - d.credited_amount)::text AS amount_txn,
            SUM((d.total_amount - d.amount_paid - d.credited_amount) * d.exchange_rate)::text AS functional,
            COUNT(*)::int AS documents
       FROM billing_documents d
      WHERE d.company_id = $1 AND d.accounting_entry_id IS NOT NULL
        AND d.status IN ('issued', 'partially_paid')
        AND d.total_amount - d.amount_paid - d.credited_amount > 0
        AND ($2::text IS NULL OR d.currency = $2)
      GROUP BY d.currency ORDER BY d.currency`,
    [companyId, currencyFilter],
  );
  const payable = await db.query<any>(
    `SELECT d.currency,
            SUM(d.total_amount - d.amount_paid - d.credited_amount)::text AS amount_txn,
            SUM((d.total_amount - d.amount_paid - d.credited_amount) * d.exchange_rate)::text AS functional,
            COUNT(*)::int AS documents
       FROM purchase_documents d
      WHERE d.company_id = $1 AND d.accounting_entry_id IS NOT NULL
        AND d.status = 'validated' AND d.kind = 'invoice'
        AND d.total_amount - d.amount_paid - d.credited_amount > 0
        AND ($2::text IS NULL OR d.currency = $2)
      GROUP BY d.currency ORDER BY d.currency`,
    [companyId, currencyFilter],
  );
  const bank = await db.query<any>(
    `SELECT ba.currency, ba.id, ba.name,
            (SELECT bt.balance::text FROM bank_transactions bt
              WHERE bt.bank_account_id = ba.id AND bt.balance IS NOT NULL
              ORDER BY bt.txn_date DESC, bt.created_at DESC LIMIT 1) AS balance
       FROM bank_accounts ba
      WHERE ba.company_id = $1 AND ba.is_active = true
        AND ($2::text IS NULL OR ba.currency = $2)
      ORDER BY ba.currency, ba.name`,
    [companyId, currencyFilter],
  );
  const realized = await db.query<any>(
    `SELECT currency, direction, status, COUNT(*)::int AS count, SUM(difference)::text AS amount
       FROM fx_realized_adjustments
      WHERE company_id = $1 AND ($2::text IS NULL OR currency = $2)
      GROUP BY currency, direction, status ORDER BY currency, direction, status`,
    [companyId, currencyFilter],
  );
  const latestValuation = await db.query<any>(
    `SELECT * FROM fx_revaluations WHERE company_id = $1
      ORDER BY valuation_date DESC LIMIT 1`,
    [companyId],
  );
  const valuationLines = latestValuation.rows[0]
    ? await db.query<any>(
        `SELECT currency, direction, SUM(difference)::text AS amount, COUNT(*)::int AS count,
                SUM(CASE WHEN blocked_reason IS NOT NULL THEN 1 ELSE 0 END)::int AS blocked
           FROM fx_revaluation_lines WHERE revaluation_id = $1
            AND ($2::text IS NULL OR currency = $2)
          GROUP BY currency, direction ORDER BY currency, direction`,
        [latestValuation.rows[0].id, currencyFilter],
      )
    : { rows: [] as any[] };
  const rates = await db.query<FxRateRow>(
    `SELECT * FROM fx_rates WHERE company_id = $1 ORDER BY rate_date DESC, base_currency, version DESC LIMIT 100`,
    [companyId],
  );
  const blocked = await db.query<any>(
    `SELECT 'billing_document'::text AS source_type, d.id, d.doc_no AS reference, d.currency,
            d.issue_date::text AS operation_date, d.customer_name AS partner_name
       FROM billing_documents d
      WHERE d.company_id = $1 AND d.status IN ('issued', 'partially_paid')
        AND d.currency <> $2
        AND NOT EXISTS (SELECT 1 FROM fx_rates r WHERE r.company_id = d.company_id
              AND r.base_currency = d.currency AND r.quote_currency = $2
              AND r.rate_date = d.issue_date AND r.status = 'validated')
     UNION ALL
     SELECT 'purchase_document'::text, d.id, d.doc_no, d.currency,
            d.issue_date::text, s.name
       FROM purchase_documents d
       JOIN purchase_suppliers s ON s.id = d.supplier_id
      WHERE d.company_id = $1 AND d.status = 'validated' AND d.kind = 'invoice'
        AND d.currency <> $2
        AND NOT EXISTS (SELECT 1 FROM fx_rates r WHERE r.company_id = d.company_id
              AND r.base_currency = d.currency AND r.quote_currency = $2
              AND r.rate_date = d.issue_date AND r.status = 'validated')
     ORDER BY operation_date, reference`,
    [companyId, functional],
  );

  const currencies = [...new Set([
    ...receivable.rows.map((r) => r.currency),
    ...payable.rows.map((r) => r.currency),
    ...bank.rows.map((r) => r.currency),
    ...realized.rows.map((r) => r.currency),
  ])].sort();
  return {
    functionalCurrency: functional,
    valuationDate,
    currencyFilter,
    currencies,
    receivables: receivable.rows,
    payables: payable.rows,
    bankAccounts: bank.rows,
    realized: realized.rows,
    latent: {
      valuation: latestValuation.rows[0] ?? null,
      totals: valuationLines.rows,
      postingBlocked: true,
    },
    rates: rates.rows,
    blockedOperations: blocked.rows,
    note:
      'Les montants sont présentés séparément par devise. Aucun total inter-devises n’est calculé. Les contre-valeurs utilisent le taux explicitement enregistré sur chaque document ; les évaluations latentes sont des simulations.',
  };
}

export async function fxReportCsv(
  db: Db,
  companyId: string,
  filters: { valuationDate?: string; currency?: string } = {},
): Promise<string> {
  const report = await fxReport(db, companyId, filters);
  const rows: string[][] = [
    ['Rapport multidevise', '', '', '', ''],
    ['Devise fonctionnelle', report.functionalCurrency, '', '', ''],
    ['Date d’évaluation', report.valuationDate, '', '', ''],
    ['Aucun total inter-devises', 'oui', '', '', ''],
    ['', '', '', '', ''],
    ['Créances clients', 'Devise', 'Montant devise', 'Contre-valeur fonctionnelle', 'Documents'],
    ...report.receivables.map((r: any) => [
      'Créances clients',
      r.currency,
      r.amount_txn,
      r.functional,
      r.documents,
    ]),
    ['', '', '', '', ''],
    ['Dettes fournisseurs', 'Devise', 'Montant devise', 'Contre-valeur fonctionnelle', 'Documents'],
    ...report.payables.map((r: any) => [
      'Dettes fournisseurs',
      r.currency,
      r.amount_txn,
      r.functional,
      r.documents,
    ]),
    ['', '', '', '', ''],
    ['Comptes bancaires', 'Devise', 'Solde natif', 'Devise', 'Compte'],
    ...report.bankAccounts.map((r: any) => ['Compte bancaire', r.currency, r.balance ?? '', r.currency, r.name]),
    ['', '', '', '', ''],
    ['Écarts réalisés', 'Devise', 'Sens', 'Statut', 'Montant'],
    ...report.realized.map((r: any) => ['Écart réalisé', r.currency, r.direction, r.status, r.amount]),
    ['', '', '', '', ''],
    ['Écarts latents simulés', 'Devise', 'Sens', 'Montant', 'Lignes'],
    ...report.latent.totals.map((r: any) => [
      'Écart latent simulé',
      r.currency,
      r.direction ?? 'bloqué',
      r.amount ?? '',
      r.count,
    ]),
    ['', '', '', '', ''],
    ['Taux', 'Paire', 'Date', 'Valeur', 'Statut', 'Source'],
    ...report.rates.map((r: any) => [
      'Taux',
      `${r.base_currency}/${r.quote_currency}`,
      r.rate_date,
      r.rate,
      r.status,
      r.source,
    ]),
    ['', '', '', '', ''],
    ['Opérations bloquées', 'Devise', 'Référence', 'Date', 'Tiers'],
    ...report.blockedOperations.map((r: any) => [
      r.source_type,
      r.currency,
      r.reference ?? '',
      r.operation_date,
      r.partner_name ?? '',
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(';')).join('\n');
}
