/**
 * Browser demonstration of multi-currency (mission 13).
 *
 * Fictional rates only. Every rate is labelled `demo` and must still be
 * validated by a human before use. Realized differences are proposed, latent
 * revaluations are simulated, transfers are previewed: nothing is posted.
 */
import { ApiError } from '../errors';
import { scaled4ToString, toScaled4 } from '../format';
import type { DemoState } from './runtime';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const amt = (value: unknown): bigint => {
  const parsed = toScaled4(value as never);
  if (parsed === null || parsed <= 0n) throw new ApiError(400, 'FX_RATE_INVALID', 'Montant ou taux invalide');
  return parsed;
};
const fmt = (value: bigint) => scaled4ToString(value);
const rate8 = (value: string) => {
  const raw = String(value).replace(',', '.').replace(/\s/g, '');
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) throw new ApiError(400, 'FX_RATE_INVALID', 'Taux décimal invalide');
  const [int, frac = ''] = raw.split('.');
  const scaled = BigInt(int!) * 100_000_000n + BigInt(frac.padEnd(8, '0'));
  if (scaled <= 0n) throw new ApiError(400, 'FX_RATE_INVALID', 'Le taux doit être strictement positif');
  return { text: `${int}.${frac.padEnd(8, '0')}`, scaled };
};
const convert = (value: bigint, rate: bigint) => {
  const product = value * rate;
  return (product + 50_000_000n) / 100_000_000n;
};

interface DemoRate {
  id: string; company_id: string; base_currency: string; quote_currency: string; rate_date: string;
  rate: string; source_kind: 'manual' | 'imported' | 'demo'; source: string; reference: string | null;
  status: 'draft' | 'validated' | 'rejected' | 'superseded'; version: number;
  validated_at: string | null; validation_note: string | null;
}
interface DemoAdjustment {
  id: string; side: 'customer' | 'supplier'; invoice_no: string; payment_no: string; partner_name: string;
  currency: string; invoice_rate: string; settlement_rate: string; settled_txn_amount: string;
  invoice_functional: string; settlement_functional: string; difference: string;
  direction: 'gain' | 'loss'; status: 'proposed' | 'posted' | 'rejected'; entry_id: string | null;
  rationale: string | null; created_at: string;
}
interface DemoValuationLine {
  id: string; currency: string; source_type: string; document_no: string;
  revalued_functional: string | null; difference: string | null;
  direction: 'gain' | 'loss' | null; blocked_reason: string | null;
}
interface DemoValuation {
  id: string; company_id: string; valuation_date: string; status: 'simulated' | 'validated';
  note: string; created_at: string; lines: DemoValuationLine[];
}
interface DemoTransfer {
  id: string; company_id: string; from_bank_account_id: string; to_bank_account_id: string;
  transfer_date: string; from_currency: string; to_currency: string; from_amount: string;
  to_amount: string; rate: string; fee_amount: string; fee_currency: string | null;
  status: 'simulated'; simulated: true; from_name: string; to_name: string;
}

export interface DemoFxState {
  settings: {
    functionalCurrency: string; functionalLocked: boolean; functionalLockedAt: string | null;
    ratePolicy: 'validated_only'; fxGainAccountId: string | null; fxLossAccountId: string | null;
    valuationEnabled: boolean; notes: string | null;
  };
  allowed: string[];
  rates: DemoRate[];
  adjustments: DemoAdjustment[];
  valuations: DemoValuation[];
  transfers: DemoTransfer[];
}

function makeRate(
  companyId: string, date: string, base: string, rate: string, status: DemoRate['status'],
  source = 'Barème fictif de démonstration (non officiel)', kind: DemoRate['source_kind'] = 'demo',
): DemoRate {
  const parsed = rate8(rate);
  return {
    id: uid(), company_id: companyId, base_currency: base, quote_currency: 'MUR', rate_date: date,
    rate: parsed.text, source_kind: kind, source, reference: 'FICTIF-DEMO-13', status, version: 1,
    validated_at: status === 'validated' ? now() : null,
    validation_note: status === 'validated' ? 'Taux fictif validé pour la démonstration.' : null,
  };
}

export function seedDemoFx(state: DemoState): void {
  if (state.fx) return;
  const company = state.companies[0];
  if (!company) return;
  const companyId = company.id;
  const date = today();
  const rates: DemoRate[] = [
    makeRate(companyId, date, 'EUR', '50.00000000', 'validated'),
    makeRate(companyId, date, 'USD', '45.00000000', 'validated'),
    makeRate(companyId, date, 'GBP', '58.00000000', 'validated'),
    makeRate(companyId, '2025-07-15', 'EUR', '48.50000000', 'validated', 'Taux fictif historique de démonstration'),
    makeRate(companyId, '2025-07-15', 'USD', '44.00000000', 'validated', 'Taux fictif historique de démonstration'),
    makeRate(companyId, '2025-07-15', 'GBP', '57.00000000', 'validated', 'Taux fictif historique de démonstration'),
    makeRate(companyId, '2025-07-16', 'EUR', '49.50000000', 'draft', 'Import fictif à confirmer', 'imported'),
  ];
  const adjustments: DemoAdjustment[] = [
    {
      id: uid(), side: 'customer', invoice_no: 'DEMO-EUR-0001', payment_no: 'DEMO-REG-0001',
      partner_name: 'Client européen fictif', currency: 'EUR', invoice_rate: '50.00000000',
      settlement_rate: '51.00000000', settled_txn_amount: '1000.0000',
      invoice_functional: '50000.0000', settlement_functional: '51000.0000',
      difference: '1000.0000', direction: 'gain', status: 'proposed', entry_id: null,
      rationale: 'Facture fictive de 1 000 EUR comptabilisée à 50 puis réglée à 51.', created_at: now(),
    },
    {
      id: uid(), side: 'supplier', invoice_no: 'DEMO-USD-0002', payment_no: 'DEMO-FOU-0002',
      partner_name: 'Fournisseur américain fictif', currency: 'USD', invoice_rate: '45.00000000',
      settlement_rate: '46.00000000', settled_txn_amount: '2000.0000',
      invoice_functional: '90000.0000', settlement_functional: '92000.0000',
      difference: '2000.0000', direction: 'loss', status: 'proposed', entry_id: null,
      rationale: 'Facture fictive de 2 000 USD réglée plus cher en roupies.', created_at: now(),
    },
    {
      id: uid(), side: 'customer', invoice_no: 'DEMO-EUR-0003', payment_no: 'DEMO-REG-0003',
      partner_name: 'Client européen fictif 2', currency: 'EUR', invoice_rate: '50.00000000',
      settlement_rate: '49.00000000', settled_txn_amount: '500.0000',
      invoice_functional: '25000.0000', settlement_functional: '24500.0000',
      difference: '500.0000', direction: 'loss', status: 'proposed', entry_id: null,
      rationale: 'Règlement partiel fictif de 500 EUR à un taux inférieur.', created_at: now(),
    },
  ];
  state.fx = {
    settings: {
      functionalCurrency: company.functional_currency,
      functionalLocked: true,
      functionalLockedAt: now(),
      ratePolicy: 'validated_only',
      fxGainAccountId: null,
      fxLossAccountId: null,
      valuationEnabled: true,
      notes: 'Données fictives de démonstration. Aucun compte de gain n’est configuré : la comptabilisation est bloquée.',
    },
    allowed: ['MUR', 'EUR', 'USD', 'GBP'],
    rates,
    adjustments,
    valuations: [],
    transfers: [],
  };
}

const configView = (state: DemoState, companyId: string) => {
  const fx = state.fx as DemoFxState;
  const accounts = state.accounts.filter((a) => a.company_id === companyId && ['revenue', 'expense'].includes(a.type));
  return {
    functionalCurrency: fx.settings.functionalCurrency,
    functionalLocked: fx.settings.functionalLocked,
    functionalLockedAt: fx.settings.functionalLockedAt,
    ratePolicy: 'validated_only',
    fxGainAccountId: fx.settings.fxGainAccountId,
    fxLossAccountId: fx.settings.fxLossAccountId,
    valuationEnabled: fx.settings.valuationEnabled,
    valuationPosting: false,
    notes: fx.settings.notes,
    allowedCurrencies: ['MUR', 'EUR', 'USD', 'GBP'].map((currency) => ({
      currency, is_allowed: fx.allowed.includes(currency),
    })),
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type })),
    supportedCurrencies: ['MUR', 'EUR', 'USD', 'GBP'],
  };
};

function resolveRate(fx: DemoFxState, from: string, to: string, date: string) {
  if (from === to) return { rate: '1.00000000', identity: true as const, row: null };
  const direct = fx.rates.find((r) => r.base_currency === from && r.quote_currency === to && r.rate_date === date && r.status === 'validated');
  if (direct) return { rate: direct.rate, identity: false as const, row: direct };
  const reverse = fx.rates.find((r) => r.base_currency === to && r.quote_currency === from && r.rate_date === date && r.status === 'validated');
  if (reverse) {
    const scaled = rate8(reverse.rate).scaled;
    const quotient = 100_000_000_000_000_000n / scaled;
    const rounded = (100_000_000_000_000_000n % scaled) * 2n >= scaled ? quotient + 1n : quotient;
    const text = `${rounded / 100_000_000n}.${String(rounded % 100_000_000n).padStart(8, '0')}`;
    return { rate: text, identity: false as const, row: reverse };
  }
  const draft = fx.rates.find((r) => r.base_currency === from && r.quote_currency === to && r.rate_date === date && r.status === 'draft');
  if (draft) throw new ApiError(409, 'FX_RATE_NOT_VALIDATED', 'Un taux existe mais n’est pas validé par un humain');
  throw new ApiError(409, 'FX_RATE_MISSING', 'Aucun taux validé pour cette paire et cette date');
}

function valuationDetail(fx: DemoFxState, id: string) {
  const row = fx.valuations.find((v) => v.id === id);
  if (!row) throw new ApiError(404, 'FX_VALUATION_NOT_FOUND', 'Évaluation introuvable');
  const totalsByCurrency: Record<string, { gain: string; loss: string; blocked: number }> = {};
  for (const line of row.lines) {
    const bucket = (totalsByCurrency[line.currency] ??= { gain: '0.0000', loss: '0.0000', blocked: 0 });
    if (line.blocked_reason) bucket.blocked += 1;
    else if (line.direction && line.difference) {
      bucket[line.direction] = fmt((toScaled4(bucket[line.direction]) ?? 0n) + (toScaled4(line.difference) ?? 0n));
    }
  }
  return { ...row, line_count: row.lines.length, totalsByCurrency, postingBlocked: true,
    note: row.note || 'Simulation fictive uniquement. Aucune écriture de réévaluation n’est créée.' };
}

function report(state: DemoState, companyId: string) {
  const fx = state.fx as DemoFxState;
  const functional = fx.settings.functionalCurrency;
  const date = today();
  const docs = state.billingDocuments.filter((d) => d.company_id === companyId && d.currency !== functional && ['issued', 'partially_paid'].includes(String(d.status)));
  const receivables = [...new Set(docs.map((d) => d.currency))].map((currency) => ({
    currency,
    amount_txn: fmt(docs.filter((d) => d.currency === currency).reduce((sum, d) => sum + (toScaled4((Number(d.total_amount) - Number(d.amount_paid ?? 0)).toFixed(4)) ?? 0n), 0n)),
    functional: '0.0000',
    documents: docs.filter((d) => d.currency === currency).length,
  }));
  const bank = state.bankAccounts.filter((b) => b.company_id === companyId).map((b) => ({
    currency: b.currency, name: b.name, balance: null,
  }));
  const blockedOperations = [
    { source_type: 'billing_document', reference: 'DEMO-USD-SANS-TAUX', currency: 'USD', operation_date: '2025-07-16' },
    { source_type: 'purchase_document', reference: 'DEMO-GBP-BROUILLON', currency: 'GBP', operation_date: today() },
  ];
  const latest = fx.valuations[fx.valuations.length - 1];
  return {
    functionalCurrency: functional, valuationDate: date, receivables,
    payables: [], bankAccounts: bank,
    realized: fx.adjustments.filter((a) => a.status !== 'rejected').map((a) => ({
      currency: a.currency, direction: a.direction, status: a.status, count: 1, amount: a.difference,
    })),
    latent: latest ? { valuation: valuationDetail(fx, latest.id), totals: [], postingBlocked: true } : { valuation: null, totals: [], postingBlocked: true },
    blockedOperations,
    note: 'Aucun total inter-devises. Les taux et opérations sont fictifs ; les opérations sans taux validé restent bloquées.',
  };
}

export function handleDemoFx(
  state: DemoState, companyId: string, method: string, rest: string,
  query: Record<string, string>, payload: any,
): unknown {
  const fx = state.fx as DemoFxState;
  if (!fx) throw new ApiError(404, 'NOT_FOUND', 'Module multidevises indisponible');

  if (method === 'GET' && (rest === '/config' || rest === '')) return configView(state, companyId);
  if (method === 'PATCH' && rest === '/config') {
    if (payload.allowedCurrencies) fx.allowed = payload.allowedCurrencies;
    if (payload.fxGainAccountId !== undefined) fx.settings.fxGainAccountId = payload.fxGainAccountId;
    if (payload.fxLossAccountId !== undefined) fx.settings.fxLossAccountId = payload.fxLossAccountId;
    if (payload.valuationEnabled !== undefined) fx.settings.valuationEnabled = Boolean(payload.valuationEnabled);
    if (payload.notes !== undefined) fx.settings.notes = payload.notes;
    if (payload.lockFunctional) {
      if (fx.settings.functionalLocked) throw new ApiError(409, 'FUNCTIONAL_CURRENCY_LOCKED', 'Devise fonctionnelle déjà verrouillée');
      fx.settings.functionalLocked = true;
      fx.settings.functionalLockedAt = now();
    }
    return { settings: configView(state, companyId) };
  }
  if (method === 'GET' && rest === '/rates') return { rates: fx.rates };
  if (method === 'POST' && rest === '/rates') {
    const parsed = rate8(payload.rate);
    if (payload.sourceKind === 'imported' && !payload.reference) {
      throw new ApiError(400, 'FX_RATE_REFERENCE_REQUIRED', 'Une référence est requise pour un taux importé');
    }
    const row: DemoRate = {
      id: uid(), company_id: companyId, base_currency: String(payload.baseCurrency).toUpperCase(),
      quote_currency: String(payload.quoteCurrency).toUpperCase(), rate_date: payload.rateDate,
      rate: parsed.text, source_kind: payload.sourceKind, source: payload.source,
      reference: payload.reference ?? null, status: 'draft', version: 1,
      validated_at: null, validation_note: null,
    };
    fx.rates.unshift(row);
    return { rate: row };
  }
  const validate = rest.match(/^\/rates\/([^/]+)\/validate$/);
  if (method === 'POST' && validate) {
    const row = fx.rates.find((r) => r.id === validate[1]);
    if (!row) throw new ApiError(404, 'FX_RATE_NOT_FOUND', 'Taux introuvable');
    if (payload?.confirm !== true) throw new ApiError(400, 'FX_RATE_VALIDATION_REQUIRED', 'Confirmation humaine requise');
    if (row.status === 'validated') return { rate: row };
    const existing = fx.rates.find((r) => r.base_currency === row.base_currency && r.quote_currency === row.quote_currency && r.rate_date === row.rate_date && r.status === 'validated');
    if (existing && !payload.supersede) throw new ApiError(409, 'FX_RATE_ALREADY_VALIDATED', 'Un taux validé existe déjà pour cette date');
    if (existing) existing.status = 'superseded';
    row.status = 'validated';
    row.validated_at = now();
    return { rate: row };
  }
  const reject = rest.match(/^\/rates\/([^/]+)\/reject$/);
  if (method === 'POST' && reject) {
    const row = fx.rates.find((r) => r.id === reject[1]);
    if (!row) throw new ApiError(404, 'FX_RATE_NOT_FOUND', 'Taux introuvable');
    row.status = 'rejected';
    return { rate: row };
  }
  if (method === 'GET' && rest === '/resolve') {
    const resolved = resolveRate(fx, String(query.from).toUpperCase(), String(query.to).toUpperCase(), query.date ?? '');
    const amount = amt(query.amount);
    const converted = convert(amount, rate8(resolved.rate).scaled);
    return {
      amount: fmt(amount), from: String(query.from).toUpperCase(), to: String(query.to).toUpperCase(),
      date: query.date, rate: resolved.rate, converted: fmt(converted),
      inverseRate: resolved.identity ? '1.00000000' : (() => {
        const scaled = rate8(resolved.rate).scaled;
        const q = 100_000_000_000_000_000n / scaled;
        const rounded = (100_000_000_000_000_000n % scaled) * 2n >= scaled ? q + 1n : q;
        return `${rounded / 100_000_000n}.${String(rounded % 100_000_000n).padStart(8, '0')}`;
      })(),
      rateId: resolved.row?.id ?? null, source: resolved.row?.source ?? 'identity',
      sourceKind: resolved.row?.source_kind ?? 'identity', official: false,
      note: 'Taux fictif saisi et validé pour la démonstration. Il n’est ni officiel ni fourni par une banque centrale.',
    };
  }
  if (method === 'GET' && rest === '/realized') return { adjustments: fx.adjustments };
  if (method === 'POST' && rest === '/realized/scan') {
    return { created: 0, adjustments: fx.adjustments, note: 'Démonstration : les écarts fictifs sont déjà proposés.' };
  }
  const postAdj = rest.match(/^\/realized\/([^/]+)\/post$/);
  if (method === 'POST' && postAdj) {
    if (payload?.confirm !== true) throw new ApiError(400, 'FX_CONFIRMATION_REQUIRED', 'Confirmation humaine requise');
    if (!fx.settings.fxGainAccountId || !fx.settings.fxLossAccountId) {
      throw new ApiError(409, 'FX_ACCOUNTS_NOT_CONFIGURED', 'Comptes de gain et de perte de change non configurés : comptabilisation bloquée');
    }
    const row = fx.adjustments.find((a) => a.id === postAdj[1]);
    if (!row) throw new ApiError(404, 'FX_ADJUSTMENT_NOT_FOUND', 'Écart introuvable');
    row.status = 'posted';
    row.entry_id = uid();
    return { adjustment: row, entry: null, demo: true };
  }
  const rejectAdj = rest.match(/^\/realized\/([^/]+)\/reject$/);
  if (method === 'POST' && rejectAdj) {
    const row = fx.adjustments.find((a) => a.id === rejectAdj[1]);
    if (!row) throw new ApiError(404, 'FX_ADJUSTMENT_NOT_FOUND', 'Écart introuvable');
    row.status = 'rejected';
    row.rationale = payload?.reason ?? row.rationale;
    return { adjustment: row };
  }
  if (method === 'GET' && rest === '/valuations') {
    return { valuations: fx.valuations.map((v) => ({ ...v, line_count: v.lines.length })) };
  }
  const valuationGet = rest.match(/^\/valuations\/([^/]+)$/);
  if (method === 'GET' && valuationGet) return { valuation: valuationDetail(fx, valuationGet[1] ?? '') };
  if (method === 'POST' && rest === '/valuations') {
    const date = payload.valuationDate;
    const existing = fx.valuations.find((v) => v.valuation_date === date);
    if (existing) return { valuation: valuationDetail(fx, existing.id), reused: true };
    const lines: DemoValuationLine[] = ['EUR', 'USD', 'GBP'].map((currency) => {
      const doc = ['DEMO-EUR-0001', 'DEMO-USD-0002', 'DEMO-EUR-0003'].find((ref) => ref.includes(currency));
      try {
        const resolved = resolveRate(fx, currency, fx.settings.functionalCurrency, date);
        const original = 50000_0000n * (currency === 'USD' ? 2n : 1n);
        const revalued = convert(original, rate8(resolved.rate).scaled);
        const difference = revalued - original;
        return {
          id: uid(), currency, source_type: 'receivable', document_no: doc ?? `${currency}-DEMO`,
          revalued_functional: fmt(revalued), difference: fmt(difference < 0n ? -difference : difference),
          direction: difference >= 0n ? 'gain' : 'loss', blocked_reason: null,
        };
      } catch (error) {
        return {
          id: uid(), currency, source_type: 'receivable', document_no: doc ?? `${currency}-DEMO`,
          revalued_functional: null, difference: null, direction: null,
          blocked_reason: error instanceof ApiError ? error.code : 'FX_RATE_MISSING',
        };
      }
    });
    const row: DemoValuation = {
      id: uid(), company_id: companyId, valuation_date: date, status: 'simulated',
      note: 'Simulation fictive. Aucune écriture n’est créée.', created_at: now(), lines,
    };
    fx.valuations.unshift(row);
    return { valuation: valuationDetail(fx, row.id), reused: false };
  }
  const validation = rest.match(/^\/valuations\/([^/]+)\/validate$/);
  if (method === 'POST' && validation) {
    const row = fx.valuations.find((v) => v.id === validation[1]);
    if (!row) throw new ApiError(404, 'FX_VALUATION_NOT_FOUND', 'Évaluation introuvable');
    if (row.lines.some((l) => l.blocked_reason)) {
      throw new ApiError(409, 'FX_VALUATION_RATE_MISSING', 'Des lignes sont bloquées : validation impossible');
    }
    row.status = 'validated';
    return { valuation: valuationDetail(fx, row.id), postingBlocked: true };
  }
  const valuationPost = rest.match(/^\/valuations\/([^/]+)\/post$/);
  if (method === 'POST' && valuationPost) {
    throw new ApiError(409, 'FX_VALUATION_POSTING_BLOCKED', 'Comptabilisation de réévaluation bloquée : politique non validée');
  }
  if (method === 'GET' && rest === '/transfers') return { transfers: fx.transfers };
  if (method === 'POST' && rest === '/transfers') {
    const from = state.bankAccounts.find((b) => b.id === payload.fromBankAccountId && b.company_id === companyId);
    const to = state.bankAccounts.find((b) => b.id === payload.toBankAccountId && b.company_id === companyId);
    if (!from || !to) throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Compte bancaire introuvable');
    if (from.id === to.id) throw new ApiError(400, 'FX_TRANSFER_SAME_ACCOUNT', 'Comptes identiques');
    const amount = amt(payload.fromAmount);
    const resolved = resolveRate(fx, from.currency, to.currency, payload.transferDate);
    const converted = convert(amount, rate8(resolved.rate).scaled);
    const fee = payload.feeAmount === null || payload.feeAmount === undefined ? 0n : amt(payload.feeAmount);
    const row: DemoTransfer = {
      id: uid(), company_id: companyId, from_bank_account_id: from.id, to_bank_account_id: to.id,
      transfer_date: payload.transferDate, from_currency: from.currency, to_currency: to.currency,
      from_amount: fmt(amount), to_amount: fmt(converted), rate: resolved.rate,
      fee_amount: fmt(fee), fee_currency: fee > 0n ? from.currency : null,
      status: 'simulated', simulated: true, from_name: from.name, to_name: to.name,
    };
    fx.transfers.unshift(row);
    return { transfer: row, postingBlocked: true, policy: 'Aucune écriture : ni produit ni charge sur un virement interne ; les frais restent distincts de l’écart de change.' };
  }
  const transferPost = rest.match(/^\/transfers\/([^/]+)\/post$/);
  if (method === 'POST' && transferPost) {
    throw new ApiError(409, 'FX_TRANSFER_POSTING_BLOCKED', 'Comptabilisation de virement bloquée');
  }
  if (method === 'GET' && rest === '/report') return { report: report(state, companyId) };
  return undefined;
}
