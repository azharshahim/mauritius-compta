/**
 * Mission 37 — coherence of the demonstration company.
 *
 * The test suite reads the same in-browser backend as the published demo and
 * checks the links the reviewing accountant will exercise: entries ↔ ledger ↔
 * trial balance ↔ statements, plus each operational subledger's own control.
 * It does not redefine an accounting, tax or payroll rule.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

const LOGIN = () => call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
const companies = () => call<{ companies: { id: string; name: string; status: string }[] }>('GET', '/companies').companies;
const first = () => companies()[0]!;
const base = () => `/companies/${first().id}`;
const num = (value: string | number) => Number(value);

interface EntrySummary { id: string; entry_no: string; status: 'draft' | 'posted'; entry_date: string; reference: string | null }
interface EntryDetail extends EntrySummary {
  lines: { debit: string; credit: string; account_id: string; description: string | null }[];
}
interface Account { id: string; code: string; name: string; type: string; is_active: boolean }

beforeEach(() => {
  resetDemo();
  LOGIN();
});

describe('mission 37 — the demonstration company is coherent', () => {
  it('opens a single clearly fictitious Mauritian company with a complete chart', () => {
    const list = companies();
    expect(list.length).toBeGreaterThanOrEqual(5);
    const company = first();
    expect(company.name).toBe('Island Trading Ltd — DEMO COMPANY');
    expect(company.id).toBeTruthy();

    for (const dossier of list) {
      expect(dossier.name).toMatch(/DEMO/);
    }

    const detail = call<{
      identification: { name: string; brn: string | null; vatNumber: string | null; registeredAddress: string | null; contactEmail: string | null };
      accounting: { financialYearStart: string; financialYearEnd: string; functionalCurrency: string; accountingStandard: string };
    }>('GET', `${base()}/settings/company`);
    expect(detail.identification.name).toBe(company.name);
    expect(detail.identification.brn).toMatch(/^DEMO-/);
    expect(detail.identification.vatNumber).toMatch(/^DEMO-/);
    expect(detail.accounting.financialYearStart).toBe('2025-07-01');
    expect(detail.accounting.financialYearEnd).toBe('2026-06-30');
    expect(detail.accounting.functionalCurrency).toBe('MUR');
    expect(detail.accounting.accountingStandard).toBe('Other');
    expect(detail.identification.registeredAddress).toMatch(/fictitious/i);
    expect(detail.identification.contactEmail).toMatch(/example\.test$/);

    const accounts = call<{ accounts: Account[] }>('GET', `${base()}/accounts`).accounts;
    expect(accounts.length).toBeGreaterThanOrEqual(30);
    expect(new Set(accounts.map((a) => a.code)).size).toBe(accounts.length);
    for (const code of ['1000', '1010', '1100', '2000', '3000', '4000', '5000', '6100', '6200']) {
      expect(accounts.some((a) => a.code === code), code).toBe(true);
    }
    const names = accounts.map((a) => a.name);
    expect(names).toContain('Share capital');
    expect(names).toContain('Trade receivables');
    expect(names).toContain('Trade payables');
    expect(names).toContain('Sales of goods');
  });

  it('balances every journal entry and keeps one explicit draft out of the posted ledger', () => {
    const entries = call<{ entries: EntrySummary[] }>('GET', `${base()}/entries?limit=500`).entries;
    expect(entries.length).toBeGreaterThan(30);
    expect(entries.filter((e) => e.status === 'draft')).toHaveLength(1);
    expect(new Set(entries.map((e) => e.entry_no)).size).toBe(entries.length);

    const accounts = new Set(call<{ accounts: Account[] }>('GET', `${base()}/accounts`).accounts.map((a) => a.id));
    let postedDebit = 0;
    let postedCredit = 0;
    let draftDebit = 0;
    let draftCredit = 0;
    for (const entry of entries) {
      const detail = call<{ entry: EntrySummary; lines: EntryDetail['lines'] }>('GET', `${base()}/entries/${entry.id}`);
      expect(detail.entry.entry_no).toBe(entry.entry_no);
      let debit = 0;
      let credit = 0;
      for (const line of detail.lines) {
        expect(accounts.has(line.account_id), `${entry.entry_no}: account`).toBe(true);
        debit += num(line.debit);
        credit += num(line.credit);
      }
      expect(Math.round(debit * 10_000), `${entry.entry_no} debit=credit`).toBe(Math.round(credit * 10_000));
      if (entry.status === 'posted') {
        postedDebit += debit;
        postedCredit += credit;
      } else {
        draftDebit += debit;
        draftCredit += credit;
      }
    }
    expect(Math.round(postedDebit * 10_000)).toBe(Math.round(postedCredit * 10_000));
    expect(Math.round(draftDebit * 10_000)).toBe(Math.round(draftCredit * 10_000));
  });

  it('links the trial balance to the statements and the dashboard without a hidden plug', () => {
    const tb = call<{
      balanced: boolean;
      rows: { code: string; openingDebit: string; openingCredit: string; movementDebit: string; movementCredit: string; closingDebit: string; closingCredit: string }[];
      totals: { openingDebit: string; openingCredit: string; movementDebit: string; movementCredit: string; closingDebit: string; closingCredit: string };
    }>('GET', `${base()}/reports/trial-balance`);

    expect(tb.balanced).toBe(true);
    expect(num(tb.totals.openingDebit)).toBe(num(tb.totals.openingCredit));
    expect(num(tb.totals.movementDebit)).toBe(num(tb.totals.movementCredit));
    expect(num(tb.totals.closingDebit)).toBe(num(tb.totals.closingCredit));
    expect(tb.rows.length).toBeGreaterThan(10);

    const rowDebit = tb.rows.reduce((sum, row) => sum + num(row.closingDebit), 0);
    const rowCredit = tb.rows.reduce((sum, row) => sum + num(row.closingCredit), 0);
    expect(Math.round(rowDebit * 10_000)).toBe(Math.round(num(tb.totals.closingDebit) * 10_000));
    expect(Math.round(rowCredit * 10_000)).toBe(Math.round(num(tb.totals.closingCredit) * 10_000));

    const st = call<{
      currency: string;
      profitAndLoss: { revenue: { total: string }; expenses: { total: string }; profit: string };
      financialPosition: { balanced: boolean; totalAssets: string; totalLiabilitiesAndEquity: string; unappropriatedResult: string };
    }>('GET', `${base()}/reports/statements`);
    expect(st.currency).toBe('MUR');
    expect(st.financialPosition.balanced).toBe(true);
    expect(num(st.financialPosition.totalAssets)).toBe(num(st.financialPosition.totalLiabilitiesAndEquity));
    expect(Math.round((num(st.profitAndLoss.revenue.total) - num(st.profitAndLoss.expenses.total)) * 10_000)).toBe(
      Math.round(num(st.profitAndLoss.profit) * 10_000),
    );

    const dashboard = call<{ kpis: { balancedSheet: boolean; profit: string; totalAssets: string; currency: string } }>(
      'GET',
      `${base()}/dashboard`,
    );
    expect(dashboard.kpis.balancedSheet).toBe(true);
    expect(dashboard.kpis.currency).toBe('MUR');
    expect(num(dashboard.kpis.profit)).toBe(num(st.profitAndLoss.profit));
    expect(num(dashboard.kpis.totalAssets)).toBe(num(st.financialPosition.totalAssets));
  });

  it('reconciles fixed assets and inventory to the ledger', () => {
    const assets = call<{ assets: { assetCode: string; description: string; totalCost: string; accumulatedDepreciation: string; accumulatedImpairment: string; netBookValue: string; status: string }[] }>(
      'GET',
      `${base()}/fixed-assets`,
    ).assets;
    expect(assets.length).toBeGreaterThanOrEqual(5);
    const codes = assets.map((a) => a.assetCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const asset of assets) {
      expect(num(asset.totalCost)).toBeGreaterThan(0);
      expect(num(asset.accumulatedDepreciation)).toBeGreaterThanOrEqual(0);
      expect(num(asset.accumulatedImpairment)).toBeGreaterThanOrEqual(0);
      expect(num(asset.netBookValue)).toBeLessThanOrEqual(num(asset.totalCost));
    }
    const fa = call<{ balanced: boolean; difference: string }>(
      'GET',
      `${base()}/fixed-assets/reports/reconciliation?asOf=2026-06-30`,
    );
    expect(fa.balanced).toBe(true);
    expect(num(fa.difference)).toBe(0);

    const inventory = call<{ balanced: boolean; totalDifference: string; rows: { subledgerValue: string; ledgerBalance: string; balanced: boolean }[] }>(
      'GET',
      `${base()}/inventory/reconciliation?asOf=2026-06-30`,
    );
    expect(inventory.balanced).toBe(true);
    expect(num(inventory.totalDifference)).toBe(0);
    for (const row of inventory.rows) {
      expect(row.balanced).toBe(true);
      expect(num(row.subledgerValue)).toBe(num(row.ledgerBalance));
    }
    const report = call<{ totals: { quantity: string; value: string } }>('GET', `${base()}/inventory/report?asOf=2026-06-30`);
    expect(num(report.totals.quantity)).toBeGreaterThan(0);
    expect(num(report.totals.value)).toBe(num(inventory.rows[0]!.subledgerValue));
  });

  it('keeps sales and purchase documents arithmetically exact and flags unposted workflow data', () => {
    const docs = call<{ documents: {
      number: string;
      kind: string;
      status: string;
      subtotal: string;
      discountTotal: string;
      taxTotal: string;
      total: string;
      amountPaid: string;
      creditedAmount: string;
      outstanding: string;
      accountingEntryId: string | null;
    }[] }>('GET', `${base()}/billing/documents`).documents;
    expect(docs.length).toBeGreaterThanOrEqual(10);
    expect(docs.some((d) => d.accountingEntryId === null)).toBe(true);
    for (const doc of docs) {
      expect(Math.round((num(doc.subtotal) - num(doc.discountTotal) + num(doc.taxTotal)) * 10_000), doc.number).toBe(
        Math.round(num(doc.total) * 10_000),
      );
      expect(num(doc.outstanding)).toBeGreaterThanOrEqual(0);
      expect(num(doc.outstanding)).toBeLessThanOrEqual(num(doc.total));
      expect(num(doc.amountPaid) + num(doc.creditedAmount)).toBeLessThanOrEqual(num(doc.total));
    }

    const billingAging = call<{ totals: { total: string } }>('GET', `${base()}/billing/aging?asOf=2026-11-01`);
    const billingSummary = call<{ openReceivables: string; postedDocuments: number }>('GET', `${base()}/billing/summary`);
    expect(num(billingSummary.openReceivables)).toBe(num(billingAging.totals.total));
    expect(billingSummary.postedDocuments).toBeLessThan(docs.length);

    const bills = call<{ documents: {
      doc_no: string | null;
      supplier_reference: string;
      kind: string;
      status: string;
      total_amount: string;
      amount_paid: string;
      credited_amount: string;
      outstanding_amount: string;
      accounting_entry_id: string | null;
      currency: string;
      lines: { netAmount: string; taxAmount: string; lineTotal: string }[];
    }[] }>('GET', `${base()}/purchases/documents`).documents;
    expect(bills.length).toBeGreaterThanOrEqual(5);
    for (const bill of bills) {
      const lineTotal = bill.lines.reduce((sum, line) => sum + num(line.lineTotal), 0);
      expect(Math.round(lineTotal * 10_000), bill.supplier_reference).toBe(Math.round(num(bill.total_amount) * 10_000));
      expect(num(bill.outstanding_amount)).toBeGreaterThanOrEqual(0);
      expect(num(bill.outstanding_amount)).toBeLessThanOrEqual(num(bill.total_amount));
      if (bill.kind === 'invoice') {
        expect(
          Math.round((num(bill.total_amount) - num(bill.amount_paid) - num(bill.credited_amount)) * 10_000),
          bill.supplier_reference,
        ).toBe(Math.round(num(bill.outstanding_amount) * 10_000));
      }
    }

    const dashboard = call<{ dashboard: { documents: { awaitingAccounting: number }; payments: { awaitingAccounting: number } } }>(
      'GET',
      `${base()}/purchases/dashboard`,
    ).dashboard;
    expect(dashboard.documents.awaitingAccounting).toBeGreaterThan(0);
    expect(bills.some((b) => b.accounting_entry_id === null)).toBe(true);

    const aging = call<{ aging: { totalsByCurrency: { currency: string; outstanding: string }[] } }>(
      'GET',
      `${base()}/purchases/aging`,
    ).aging;
    const mur = aging.totalsByCurrency.find((row) => row.currency === 'MUR')!;
    const invoiceMur = bills
      .filter((b) => b.kind === 'invoice' && b.status === 'validated' && b.currency === 'MUR')
      .reduce((sum, b) => sum + num(b.outstanding_amount), 0);
    expect(Math.round(num(mur.outstanding) * 10_000)).toBe(Math.round(invoiceMur * 10_000));
    expect(aging.totalsByCurrency.length).toBeGreaterThanOrEqual(2); // MUR and EUR are never added together
  });

  it('explains every bank difference instead of forcing a reconciled balance', () => {
    const accounts = call<{ accounts: { id: string; name: string; currency: string }[] }>('GET', `${base()}/bank/accounts`).accounts;
    expect(accounts.length).toBe(2);
    const mur = accounts.find((a) => a.currency === 'MUR')!;
    const report = call<{ report: {
      status: string;
      bankBalance: string;
      ledgerBalance: string;
      difference: string;
      matchedCount: number;
      unmatchedCount: number;
      explanations: { code: string; en: string; fr: string }[];
    } }>('GET', `${base()}/bank/report?bankAccountId=${mur.id}`).report;

    expect(report.status).toBe('differences');
    expect(report.unmatchedCount).toBeGreaterThan(0);
    expect(num(report.difference)).toBe(num(report.bankBalance) - num(report.ledgerBalance));
    expect(report.explanations.map((e) => e.code)).toContain('UNMATCHED_BANK_TRANSACTIONS');
    expect(report.explanations.map((e) => e.code)).toContain('UNMATCHED_LEDGER_LINES');
    expect(report.explanations.map((e) => e.code)).toContain('BALANCE_DIFFERENCE');
    expect(report.explanations.every((e) => e.en && e.fr)).toBe(true);
    expect(report.matchedCount + report.unmatchedCount).toBeGreaterThan(0);
  });

  it('keeps payroll explicitly simulated and arithmetically consistent', () => {
    const employees = call<{ employees: { id: string; full_name: string }[] }>('GET', `${base()}/payroll/employees`).employees;
    expect(employees).toHaveLength(18);
    expect(employees.every((e) => e.full_name.trim().length > 2)).toBe(true);
    expect(new Set(employees.map((e) => e.full_name)).size).toBe(employees.length);

    const periods = call<{ periods: { id: string; status: string }[] }>('GET', `${base()}/payroll/periods`).periods;
    expect(periods).toHaveLength(1);
    expect(periods[0]!.status).toBe('blocked');

    const calculations = call<{ calculations: { id: string; status: string }[] }>(
      'GET',
      `${base()}/payroll/periods/${periods[0]!.id}/calculations`,
    ).calculations;
    expect(calculations).toHaveLength(18);

    const payslip = call<{ payslips: { id: string; status: string; snapshot: {
      disclaimer: string;
      status: string;
      statutoryStatus: string;
      totals: { base: string; additionalRemuneration: string; gross: string; paye: string; csgEmployee: string; nsfEmployee: string; netAfterStatutory: string; csgEmployer: string; nsfEmployer: string; trainingLevy: string; employerCost: string };
    } }[] }>('GET', `${base()}/payroll/payslips?periodId=${periods[0]!.id}`).payslips;
    expect(payslip.length).toBeGreaterThan(0);
    const snapshot = payslip[0]!.snapshot;
    expect(snapshot.status).not.toBe('approved_for_test');
    expect(snapshot.statutoryStatus).toBe('EXPERT_REVIEW_PENDING');
    expect(snapshot.disclaimer).toMatch(/NOT FOR PAYMENT|SIMULATION/i);
    expect(Math.round((num(snapshot.totals.base) + num(snapshot.totals.additionalRemuneration)) * 10_000)).toBe(
      Math.round(num(snapshot.totals.gross) * 10_000),
    );
    expect(
      Math.round(
        (num(snapshot.totals.gross) - num(snapshot.totals.paye) - num(snapshot.totals.csgEmployee) - num(snapshot.totals.nsfEmployee)) * 10_000,
      ),
    ).toBe(Math.round(num(snapshot.totals.netAfterStatutory) * 10_000));
    expect(
      Math.round(
        (num(snapshot.totals.gross) + num(snapshot.totals.csgEmployer) + num(snapshot.totals.nsfEmployer) + num(snapshot.totals.trainingLevy)) * 10_000,
      ),
    ).toBe(Math.round(num(snapshot.totals.employerCost) * 10_000));
    expect(payslip[0]!.status).toBe('simulation');
  });

  it('isolates companies and reproduces the same demonstration after a reset', () => {
    const before = {
      name: first().name,
      entries: call<{ entries: EntrySummary[] }>('GET', `${base()}/entries?limit=500`).entries.length,
      accounts: call<{ accounts: Account[] }>('GET', `${base()}/accounts`).accounts.length,
      tb: call<{ totals: { closingDebit: string } }>('GET', `${base()}/reports/trial-balance`).totals.closingDebit,
      bills: call<{ documents: unknown[] }>('GET', `${base()}/purchases/documents`).documents.length,
      assets: call<{ assets: unknown[] }>('GET', `${base()}/fixed-assets`).assets.length,
    };

    const second = companies().find((c) => c.name.includes('Case Noyale'))!;
    const secondAccounts = call<{ accounts: Account[] }>('GET', `/companies/${second.id}/accounts`).accounts;
    expect(secondAccounts.length).toBeGreaterThan(0);
    expect(secondAccounts.every((a) => a.id)).toBe(true);
    const secondTb = call<{ balanced: boolean }>('GET', `/companies/${second.id}/reports/trial-balance`);
    expect(secondTb.balanced).toBe(true);

    resetDemo();
    LOGIN();
    const after = {
      name: first().name,
      entries: call<{ entries: EntrySummary[] }>('GET', `${base()}/entries?limit=500`).entries.length,
      accounts: call<{ accounts: Account[] }>('GET', `${base()}/accounts`).accounts.length,
      tb: call<{ totals: { closingDebit: string } }>('GET', `${base()}/reports/trial-balance`).totals.closingDebit,
      bills: call<{ documents: unknown[] }>('GET', `${base()}/purchases/documents`).documents.length,
      assets: call<{ assets: unknown[] }>('GET', `${base()}/fixed-assets`).assets.length,
    };
    expect(after).toEqual(before);
  });
});
