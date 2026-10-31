/**
 * Mission 21 — reusable year-end checklist.
 *
 * A check for a module that is not implemented is marked "unavailable"; a
 * configuration that is missing is "pending". Neither is ever reported as a
 * pass. No check closes a period automatically.
 */
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { computeTrialBalance } from '../reports/service.js';
import { writeAudit } from '../../lib/audit.js';
import type { ChecklistItem, FinancialYearActor } from './types.js';
import { accrualCheck } from '../accruals/service.js';
import { inventoryCheck, valuationReport } from '../inventory/service.js';
import { provisionCheck } from '../provisions/service.js';

function count(value: unknown): number { return Number(value ?? 0); }
function money(value: unknown): string { return String(value ?? '0'); }

async function settings(db: Db, companyIdValue: string) {
  await db.query(`INSERT INTO fiscal_year_settings (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING`, [companyIdValue]);
  const res = await db.query<any>('SELECT * FROM fiscal_year_settings WHERE company_id = $1', [companyIdValue]);
  return res.rows[0];
}

export async function buildChecklist(db: Db, companyIdValue: string, periodId: string) {
  const periodRes = await db.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [periodId, companyIdValue]);
  const period = periodRes.rows[0];
  if (!period) throw notFound('PERIOD_NOT_FOUND', 'Accounting period not found');
  const company = await db.query<any>('SELECT functional_currency FROM companies WHERE id = $1', [companyIdValue]);
  const currency = company.rows[0]!.functional_currency;
  const items: ChecklistItem[] = [];
  const add = (item: ChecklistItem) => items.push(item);

  // 1. Unposted journals.
  const drafts = await db.query<any>(`SELECT count(*)::int AS count FROM journal_entries WHERE company_id = $1 AND status = 'draft' AND entry_date BETWEEN $2 AND $3`, [companyIdValue, period.start_date, period.end_date]);
  add({ code: 'UNPOSTED_JOURNALS', module: 'accounting', labelEn: 'Unposted journals', labelFr: 'Écritures non comptabilisées',
    state: count(drafts.rows[0]?.count) > 0 ? 'warning' : 'ok', count: count(drafts.rows[0]?.count),
    detailEn: `${count(drafts.rows[0]?.count)} draft entry(ies) in the period.`, detailFr: `${count(drafts.rows[0]?.count)} écriture(s) en brouillon dans la période.` });

  // 2. Trial-balance integrity.
  const unbalanced = await db.query<any>(`SELECT count(*)::int AS count FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.company_id = $1 AND e.status = 'posted' AND e.entry_date BETWEEN $2 AND $3 GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)) x`, [companyIdValue, period.start_date, period.end_date]);
  const trial = await computeTrialBalance(db, companyIdValue, currency, { from: period.start_date, to: period.end_date });
  const tbBalanced = trial.totals.closingDebit === trial.totals.closingCredit;
  add({ code: 'TRIAL_BALANCE_INTEGRITY', module: 'accounting', labelEn: 'Trial-balance integrity', labelFr: 'Intégrité de la balance',
    state: count(unbalanced.rows[0]?.count) > 0 || !tbBalanced ? 'block' : 'ok', count: count(unbalanced.rows[0]?.count),
    amount: trial.totals.closingDebit,
    detailEn: count(unbalanced.rows[0]?.count) > 0 ? `${count(unbalanced.rows[0]?.count)} posted entry(ies) are unbalanced.` : `Closing debit ${trial.totals.closingDebit} = credit ${trial.totals.closingCredit}.`,
    detailFr: count(unbalanced.rows[0]?.count) > 0 ? `${count(unbalanced.rows[0]?.count)} écriture(s) comptabilisée(s) sont déséquilibrées.` : `Débit ${trial.totals.closingDebit} = crédit ${trial.totals.closingCredit}.` });

  // 3. Outstanding bank reconciliations.
  const bankAccounts = await db.query<any>('SELECT count(*)::int AS count FROM bank_accounts WHERE company_id = $1 AND is_active', [companyIdValue]);
  const bankOpen = await db.query<any>(`SELECT count(*)::int AS count FROM bank_transactions WHERE company_id = $1 AND txn_date BETWEEN $2 AND $3 AND status IN ('unmatched','proposed','review')`, [companyIdValue, period.start_date, period.end_date]);
  add({ code: 'BANK_RECONCILIATION', module: 'bank', labelEn: 'Outstanding reconciliations', labelFr: 'Rapprochements en suspens',
    state: count(bankAccounts.rows[0]?.count) === 0 ? 'ok' : count(bankOpen.rows[0]?.count) > 0 ? 'warning' : 'ok',
    count: count(bankOpen.rows[0]?.count),
    detailEn: count(bankAccounts.rows[0]?.count) === 0 ? 'No active bank account.' : `${count(bankOpen.rows[0]?.count)} bank transaction(s) are not reconciled.`,
    detailFr: count(bankAccounts.rows[0]?.count) === 0 ? 'Aucun compte bancaire actif.' : `${count(bankOpen.rows[0]?.count)} opération(s) bancaire(s) non rapprochée(s).` });

  // 4. Suspense accounts: only the accounts explicitly configured by the user.
  const cfg = await settings(db, companyIdValue);
  const suspenseIds: string[] = Array.isArray(cfg.suspense_account_ids) ? cfg.suspense_account_ids : [];
  if (suspenseIds.length === 0) {
    add({ code: 'SUSPENSE_ACCOUNTS', module: 'accounting', labelEn: 'Suspense accounts', labelFr: 'Comptes d’attente',
      state: 'pending', detailEn: 'No suspense account is configured; this check cannot pass silently.', detailFr: 'Aucun compte d’attente n’est configuré ; ce contrôle ne peut pas réussir silencieusement.' });
  } else {
    const sc = await db.query<any>(`SELECT a.code, a.name, COALESCE(SUM(l.debit - l.credit),0)::text AS net FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id AND l.entry_id IN (SELECT id FROM journal_entries WHERE company_id = $1 AND status = 'posted' AND entry_date <= $2) WHERE a.company_id = $1 AND a.id = ANY($3::uuid[]) GROUP BY a.id, a.code, a.name ORDER BY a.code`, [companyIdValue, period.end_date, suspenseIds]);
    const nonZero = sc.rows.filter((r: any) => Number(r.net) !== 0);
    add({ code: 'SUSPENSE_ACCOUNTS', module: 'accounting', labelEn: 'Suspense accounts', labelFr: 'Comptes d’attente',
      state: nonZero.length > 0 ? 'warning' : 'ok', count: nonZero.length,
      detailEn: nonZero.length > 0 ? `${nonZero.length} configured suspense account(s) carry a non-zero balance.` : 'All configured suspense accounts are zero.',
      detailFr: nonZero.length > 0 ? `${nonZero.length} compte(s) d’attente configuré(s) portent un solde non nul.` : 'Tous les comptes d’attente configurés sont soldés.' });
  }

  // 5. Fixed-asset depreciation.
  const assets = await db.query<any>(`SELECT count(*)::int AS count FROM fixed_assets WHERE company_id = $1 AND status IN ('in_service','suspended') AND in_service_date <= $2`, [companyIdValue, period.end_date]);
  const depBatches = await db.query<any>(`SELECT count(*)::int AS count, MAX(period_end)::text AS last_end FROM fixed_asset_depreciation_batches WHERE company_id = $1 AND status = 'POSTED' AND period_end <= $2`, [companyIdValue, period.end_date]);
  const assetCount = count(assets.rows[0]?.count);
  const batchCount = count(depBatches.rows[0]?.count);
  const lastEnd = depBatches.rows[0]?.last_end ?? null;
  add({ code: 'FIXED_ASSET_DEPRECIATION', module: 'fixed_assets', labelEn: 'Fixed-asset depreciation', labelFr: 'Amortissement des immobilisations',
    state: assetCount === 0 ? 'ok' : batchCount === 0 ? 'warning' : lastEnd && lastEnd < period.end_date ? 'warning' : 'ok',
    count: assetCount,
    detailEn: assetCount === 0 ? 'No asset in service.' : batchCount === 0 ? `${assetCount} asset(s) in service but no posted depreciation batch.` : `${assetCount} asset(s), last posted depreciation period ending ${lastEnd}.`,
    detailFr: assetCount === 0 ? 'Aucune immobilisation en service.' : batchCount === 0 ? `${assetCount} immobilisation(s) en service mais aucun lot d’amortissement comptabilisé.` : `${assetCount} immobilisation(s), dernier lot d’amortissement arrêté au ${lastEnd}.` });

  // 6. Accruals, prepayments and deferred income (mission 22).
  const accruals = await accrualCheck(db, companyIdValue, period.start_date, period.end_date);
  const accrualSchedules = await db.query<any>(`SELECT count(*)::int AS count FROM accrual_schedules
    WHERE company_id=$1 AND start_date <= $2 AND end_date >= $3`, [companyIdValue, period.end_date, period.start_date]);
  const accrualCount = count(accrualSchedules.rows[0]?.count);
  if (accrualCount === 0) {
    add({ code: 'ACCRUALS_PREPAYMENTS', module: 'accruals', labelEn: 'Accruals and prepayments', labelFr: 'Charges à payer et produits constatés d’avance',
      state: 'pending', detailEn: 'No accrual, prepayment or deferred-income schedule covers this period. Completeness cannot be asserted automatically.', detailFr: 'Aucun échéancier de charges à payer, charges constatées d’avance ou produits différés ne couvre cette période. L’exhaustivité ne peut pas être affirmée automatiquement.' });
  } else if (!accruals.report.balanced) {
    add({ code: 'ACCRUALS_PREPAYMENTS', module: 'accruals', labelEn: 'Accruals and prepayments', labelFr: 'Charges à payer et produits constatés d’avance',
      state: 'block', count: accruals.pendingLines, detailEn: 'One or more accrual balance accounts do not reconcile with the general ledger.', detailFr: 'Un ou plusieurs comptes de bilan d’échéanciers ne se rapprochent pas du grand livre.' });
  } else {
    const issues = accruals.pendingLines + accruals.draftSchedules + accruals.missingDocuments;
    add({ code: 'ACCRUALS_PREPAYMENTS', module: 'accruals', labelEn: 'Accruals and prepayments', labelFr: 'Charges à payer et produits constatés d’avance',
      state: issues > 0 ? 'warning' : 'ok', count: issues,
      detailEn: issues > 0 ? `${accruals.pendingLines} pending line(s), ${accruals.draftSchedules} draft schedule(s), ${accruals.missingDocuments} missing document(s).` : `${accrualCount} schedule(s) reconcile with the ledger and no line is pending.`,
      detailFr: issues > 0 ? `${accruals.pendingLines} ligne(s) en attente, ${accruals.draftSchedules} échéancier(s) en brouillon, ${accruals.missingDocuments} justificatif(s) manquant(s).` : `${accrualCount} échéancier(s) se rapprochent du grand livre et aucune ligne n’est en attente.` });
  }

  // 7. Provisions (mission 22) — no IAS 37 or Mauritian rule is asserted.
  const provisions = await provisionCheck(db, companyIdValue, period.end_date);
  const provisionRows = await db.query<any>('SELECT count(*)::int AS count FROM provisions WHERE company_id=$1', [companyIdValue]);
  const provisionCount = count(provisionRows.rows[0]?.count);
  if (provisionCount === 0) {
    add({ code: 'PROVISIONS', module: 'provisions', labelEn: 'Provisions', labelFr: 'Provisions',
      state: 'pending', detailEn: 'No provision is recorded. Completeness cannot be asserted automatically and no recognition rule is selected.', detailFr: 'Aucune provision n’est enregistrée. L’exhaustivité ne peut pas être affirmée automatiquement et aucune règle de reconnaissance n’est sélectionnée.' });
  } else if (!provisions.reconciliation.balanced) {
    add({ code: 'PROVISIONS', module: 'provisions', labelEn: 'Provisions', labelFr: 'Provisions',
      state: 'block', count: provisions.pendingMovements,
      detailEn: 'The provision register does not reconcile with its liability account(s).', detailFr: 'Le registre des provisions ne se rapproche pas de son ou de ses comptes de dettes.' });
  } else {
    const issues = provisions.pendingMovements + provisions.missingEvidence;
    add({ code: 'PROVISIONS', module: 'provisions', labelEn: 'Provisions', labelFr: 'Provisions',
      state: issues > 0 ? 'warning' : 'ok', count: issues,
      detailEn: issues > 0 ? `${provisions.pendingMovements} movement(s) await approval or posting; ${provisions.missingEvidence} provision(s) lack evidence.` : `${provisionCount} provision(s) reconcile with the ledger; no movement is pending.`,
      detailFr: issues > 0 ? `${provisions.pendingMovements} mouvement(s) en attente d’approbation ou de comptabilisation ; ${provisions.missingEvidence} provision(s) sans preuve.` : `${provisionCount} provision(s) se rapprochent du grand livre ; aucun mouvement en attente.` });
  }

  // 8. Inventory (mission 22).
  const inventory = await inventoryCheck(db, companyIdValue, period.end_date);
  if (inventory.itemCount === 0) {
    add({ code: 'INVENTORY', module: 'inventory', labelEn: 'Inventory', labelFr: 'Stocks',
      state: 'pending', detailEn: 'No active inventory item is configured. If the company holds stock, the register must be completed.', detailFr: 'Aucun article de stock actif n’est configuré. Si la société détient du stock, le registre doit être complété.' });
  } else if (inventory.negativeBalances > 0 || !inventory.reconciliation.balanced) {
    add({ code: 'INVENTORY', module: 'inventory', labelEn: 'Inventory', labelFr: 'Stocks',
      state: 'block', count: inventory.negativeBalances,
      detailEn: inventory.negativeBalances > 0 ? `${inventory.negativeBalances} stock balance(s) are negative.` : 'The inventory subledger does not reconcile with the general ledger.',
      detailFr: inventory.negativeBalances > 0 ? `${inventory.negativeBalances} solde(s) de stock sont négatifs.` : 'Le sous-registre des stocks ne se rapproche pas du grand livre.' });
  } else {
    const pending = inventory.pendingMovements + inventory.pendingCounts + inventory.pendingWriteDowns;
    const valuation = await valuationReport(db, companyIdValue, period.end_date);
    add({ code: 'INVENTORY', module: 'inventory', labelEn: 'Inventory', labelFr: 'Stocks',
      state: pending > 0 || inventory.missingJournal > 0 ? 'warning' : 'ok', count: pending,
      amount: valuation.totals.value,
      detailEn: pending > 0 || inventory.missingJournal > 0
        ? `${inventory.pendingMovements} movement(s), ${inventory.pendingCounts} count(s) and ${inventory.pendingWriteDowns} write-down(s) await approval or posting; ${inventory.missingJournal} approved movement(s) lack an active journal.`
        : `Valuation at ${period.end_date}: ${valuation.totals.value}; ${inventory.itemCount} active item(s), reconciled with the ledger.`,
      detailFr: pending > 0 || inventory.missingJournal > 0
        ? `${inventory.pendingMovements} mouvement(s), ${inventory.pendingCounts} inventaire(s) et ${inventory.pendingWriteDowns} dépréciation(s) en attente d’approbation ou de comptabilisation ; ${inventory.missingJournal} mouvement(s) approuvé(s) sans journal actif.`
        : `Valorisation au ${period.end_date} : ${valuation.totals.value} ; ${inventory.itemCount} article(s) actif(s), rapproché(s) du grand livre.` });
  }

  // 8. Customer and supplier balances.
  const customer = await db.query<any>(`SELECT count(*)::int AS count, COALESCE(SUM(total_amount),0)::text AS total FROM billing_documents WHERE company_id = $1 AND kind = 'invoice' AND status = 'issued' AND issue_date <= $2`, [companyIdValue, period.end_date]);
  const supplier = await db.query<any>(`SELECT count(*)::int AS count, COALESCE(SUM(GREATEST(total_amount - amount_paid - credited_amount, 0)),0)::text AS total FROM purchase_documents WHERE company_id = $1 AND status = 'validated' AND payment_status <> 'paid' AND issue_date <= $2`, [companyIdValue, period.end_date]);
  add({ code: 'CUSTOMER_BALANCES', module: 'billing', labelEn: 'Customer balances', labelFr: 'Soldes clients',
    state: count(customer.rows[0]?.count) > 0 ? 'pending' : 'ok', count: count(customer.rows[0]?.count), amount: money(customer.rows[0]?.total),
    detailEn: `${count(customer.rows[0]?.count)} open customer invoice(s), total ${money(customer.rows[0]?.total)}. Review required.`,
    detailFr: `${count(customer.rows[0]?.count)} facture(s) client ouverte(s), total ${money(customer.rows[0]?.total)}. Revue requise.` });
  add({ code: 'SUPPLIER_BALANCES', module: 'purchases', labelEn: 'Supplier balances', labelFr: 'Soldes fournisseurs',
    state: count(supplier.rows[0]?.count) > 0 ? 'pending' : 'ok', count: count(supplier.rows[0]?.count), amount: money(supplier.rows[0]?.total),
    detailEn: `${count(supplier.rows[0]?.count)} open supplier document(s), outstanding ${money(supplier.rows[0]?.total)}. Review required.`,
    detailFr: `${count(supplier.rows[0]?.count)} document(s) fournisseur ouvert(s), reste ${money(supplier.rows[0]?.total)}. Revue requise.` });

  // 9. Profit allocation / closing state.
  const closing = await db.query<any>(`SELECT * FROM fiscal_closings WHERE company_id = $1 AND source_period_id = $2 ORDER BY version DESC LIMIT 1`, [companyIdValue, periodId]);
  const closingRow = closing.rows[0] ?? null;
  const allocation = closingRow ? await db.query<any>(`SELECT status, entry_id FROM equity_allocations WHERE company_id = $1 AND closing_id = $2 ORDER BY created_at DESC LIMIT 1`, [companyIdValue, closingRow.id]) : { rows: [] };
  const alloc = allocation.rows[0] ?? null;
  add({ code: 'PROFIT_ALLOCATION', module: 'equity', labelEn: 'Profit allocation', labelFr: 'Affectation du résultat',
    state: !closingRow ? 'pending' : closingRow.status !== 'POSTED' ? 'pending' : Number(closingRow.result_amount) === 0 ? 'ok' : alloc?.status === 'POSTED' ? 'ok' : 'pending',
    amount: closingRow ? formatAmount(parseAmount(String(closingRow.result_amount))) : undefined,
    detailEn: !closingRow ? 'No closing has been prepared.' : closingRow.status !== 'POSTED' ? `Closing status: ${closingRow.status}.` : Number(closingRow.result_amount) === 0 ? 'Result is zero: no allocation entry is required.' : alloc?.status === 'POSTED' ? 'A posted allocation exists.' : 'The result is not yet allocated by a posted decision.',
    detailFr: !closingRow ? 'Aucune clôture n’a été préparée.' : closingRow.status !== 'POSTED' ? `Statut de clôture : ${closingRow.status}.` : Number(closingRow.result_amount) === 0 ? 'Le résultat est nul : aucune écriture d’affectation n’est requise.' : alloc?.status === 'POSTED' ? 'Une affectation comptabilisée existe.' : 'Le résultat n’est pas encore affecté par une décision comptabilisée.' });

  // 10. Prior-year adjustments.
  const adjustments = await db.query<any>(`SELECT status, count(*)::int AS count FROM prior_year_adjustments WHERE company_id = $1 AND source_period_id = $2 GROUP BY status`, [companyIdValue, periodId]);
  const pendingAdj = adjustments.rows.filter((r: any) => ['PROPOSED', 'APPROVED'].includes(r.status)).reduce((s: number, r: any) => s + count(r.count), 0);
  add({ code: 'PRIOR_YEAR_ADJUSTMENTS', module: 'financial_years', labelEn: 'Prior-year adjustments', labelFr: 'Ajustements sur exercices antérieurs',
    state: pendingAdj > 0 ? 'warning' : 'ok', count: pendingAdj,
    detailEn: pendingAdj > 0 ? `${pendingAdj} adjustment(s) await approval or posting.` : 'No pending prior-year adjustment for this period.',
    detailFr: pendingAdj > 0 ? `${pendingAdj} ajustement(s) en attente d’approbation ou de comptabilisation.` : 'Aucun ajustement en attente pour cette période.' });

  // 11. Supporting documents.
  const missingDocs = await db.query<any>(`SELECT count(*)::int AS count FROM journal_entries e WHERE e.company_id = $1 AND e.status = 'posted' AND e.entry_date BETWEEN $2 AND $3 AND e.source NOT IN ('closing','equity_allocation') AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.entry_id = e.id AND a.company_id = e.company_id)`, [companyIdValue, period.start_date, period.end_date]);
  add({ code: 'MISSING_SUPPORTING_DOCUMENTS', module: 'attachments', labelEn: 'Missing supporting documents', labelFr: 'Justificatifs manquants',
    state: count(missingDocs.rows[0]?.count) > 0 ? 'warning' : 'ok', count: count(missingDocs.rows[0]?.count),
    detailEn: `${count(missingDocs.rows[0]?.count)} posted entry(ies) have no attached document. A reference may be held elsewhere.`,
    detailFr: `${count(missingDocs.rows[0]?.count)} écriture(s) comptabilisée(s) n’ont aucun document joint. Un justificatif peut exister ailleurs.` });

  const counts = items.reduce((acc: Record<string, number>, item) => { acc[item.state] = (acc[item.state] ?? 0) + 1; return acc; }, { ok: 0, warning: 0, pending: 0, unavailable: 0, block: 0 });
  return {
    period: { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date, status: period.status },
    items, counts, total: items.length,
    ready: counts.block === 0 && counts.warning === 0 && counts.pending === 0,
    noteEn: 'Unavailable or pending checks are never reported as passed. No check posts or closes anything.',
    noteFr: 'Les contrôles indisponibles ou en attente ne sont jamais présentés comme réussis. Aucun contrôle ne comptabilise ni ne clôture.',
  };
}

export async function saveChecklist(db: Db, actor: FinancialYearActor, periodId: string) {
  const report = await buildChecklist(db, actor.companyId, periodId);
  const company = await db.query<any>('SELECT cabinet_id FROM companies WHERE id = $1', [actor.companyId]);
  const versionRes = await db.query<any>('SELECT COALESCE(MAX(version),0)::int AS v FROM year_end_checklists WHERE company_id = $1 AND period_id = $2', [actor.companyId, periodId]);
  const version = Number(versionRes.rows[0]!.v) + 1;
  const res = await db.query<any>(
    `INSERT INTO year_end_checklists (cabinet_id, company_id, period_id, version, status, items, counts, created_by)
     VALUES ($1,$2,$3,$4,'GENERATED',$5::jsonb,$6::jsonb,$7) RETURNING id`,
    [company.rows[0]!.cabinet_id, actor.companyId, periodId, version, JSON.stringify(report.items), JSON.stringify(report.counts), actor.userId],
  );
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action: 'checklist.generate', entityType: 'year_end_checklist', entityId: res.rows[0].id, details: { periodId, version, counts: report.counts }, ip: actor.ip ?? null });
  return getChecklist(db, actor.companyId, res.rows[0].id);
}

async function checklistView(db: Db, companyIdValue: string, id: string) {
  const res = await db.query<any>(`SELECT c.*, p.name AS period_name, p.start_date, p.end_date, p.status AS period_status, u.full_name AS created_by_name, ru.full_name AS reviewed_by_name FROM year_end_checklists c JOIN accounting_periods p ON p.id = c.period_id LEFT JOIN app_users u ON u.id = c.created_by LEFT JOIN app_users ru ON ru.id = c.reviewed_by WHERE c.company_id = $1 AND c.id = $2`, [companyIdValue, id]);
  if (!res.rows[0]) throw notFound('CHECKLIST_NOT_FOUND', 'Year-end checklist not found');
  const r = res.rows[0];
  return { id: r.id, version: r.version, status: r.status, period: { id: r.period_id, name: r.period_name, startDate: r.start_date, endDate: r.end_date, status: r.period_status }, items: r.items, counts: r.counts, createdByName: r.created_by_name, createdAt: r.created_at, reviewedByName: r.reviewed_by_name, reviewedAt: r.reviewed_at, reviewNote: r.review_note };
}
export async function getChecklist(db: Db, companyIdValue: string, id: string) { return checklistView(db, companyIdValue, id); }
export async function listChecklists(db: Db, companyIdValue: string, periodId?: string) {
  const res = await db.query<any>(`SELECT c.id, c.version, c.status, c.period_id, p.name AS period_name, c.counts, c.created_at FROM year_end_checklists c JOIN accounting_periods p ON p.id = c.period_id WHERE c.company_id = $1 AND ($2::uuid IS NULL OR c.period_id = $2) ORDER BY c.created_at DESC LIMIT 50`, [companyIdValue, periodId ?? null]);
  return res.rows;
}
export async function reviewChecklist(db: Db, actor: FinancialYearActor, id: string, input: { note: string; confirm: boolean }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) throw badRequest('FINANCIAL_YEAR_DECISION_REQUIRED', 'A confirmation and a review note of at least 10 characters are required');
  const res = await db.query<any>('SELECT status FROM year_end_checklists WHERE company_id = $1 AND id = $2', [actor.companyId, id]);
  if (!res.rows[0]) throw notFound('CHECKLIST_NOT_FOUND', 'Year-end checklist not found');
  if (res.rows[0].status === 'REVIEWED') throw conflict('CONFLICT', 'This checklist is already reviewed');
  await db.query(`UPDATE year_end_checklists SET status='REVIEWED', reviewed_by=$2, reviewed_at=now(), review_note=$3 WHERE id=$1 AND company_id=$4`, [id, actor.userId, String(input.note).trim(), actor.companyId]);
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action: 'checklist.review', entityType: 'year_end_checklist', entityId: id, details: { note: String(input.note).trim() }, ip: actor.ip ?? null });
  return checklistView(db, actor.companyId, id);
}

export async function getChecklistSettings(db: Db, companyIdValue: string) {
  return settings(db, companyIdValue);
}
export async function updateChecklistSettings(db: Db, actor: FinancialYearActor, input: { suspenseAccountIds?: string[]; retentionMonths?: number | null; retentionNote?: string | null; documentBackupNote?: string | null }) {
  await settings(db, actor.companyId);
  if (input.suspenseAccountIds) {
    const ids = [...new Set(input.suspenseAccountIds)];
    const res = await db.query<any>('SELECT id FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])', [actor.companyId, ids]);
    if (res.rows.length !== ids.length) throw badRequest('ACCOUNT_NOT_FOUND', 'A suspense account does not belong to this company');
    await db.query(`UPDATE fiscal_year_settings SET suspense_account_ids=$2::jsonb, updated_by=$3, updated_at=now() WHERE company_id=$1`, [actor.companyId, JSON.stringify(ids), actor.userId]);
  }
  if (input.retentionMonths !== undefined) {
    if (input.retentionMonths !== null && (!Number.isInteger(input.retentionMonths) || input.retentionMonths <= 0)) throw badRequest('VALIDATION_ERROR', 'Retention months must be a positive integer or null');
    await db.query(`UPDATE fiscal_year_settings SET retention_months=$2, retention_note=$3, document_backup_note=$4, updated_by=$5, updated_at=now() WHERE company_id=$1`, [actor.companyId, input.retentionMonths, input.retentionNote ? String(input.retentionNote).trim().slice(0, 2000) : null, input.documentBackupNote ? String(input.documentBackupNote).trim().slice(0, 2000) : null, actor.userId]);
  }
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action: 'financial_year.settings.update', entityType: 'fiscal_year_settings', entityId: actor.companyId, details: { ...input }, ip: actor.ip ?? null });
  return settings(db, actor.companyId);
}
