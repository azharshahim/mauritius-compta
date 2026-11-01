/**
 * Mission 42 — VAT control statement.
 *
 * It is deliberately *not* a MRA return and contains no invented rate, box or
 * threshold. It only reports posted general-ledger movements on the VAT input
 * and output accounts of the company's chart, per currency.
 */
import type { Db } from '../../db/index.js';
import { formatAmount, parseAmount } from '../../lib/money.js';

export interface VatControl {
  from: string;
  to: string;
  accounts: {
    accountId: string;
    code: string;
    name: string;
    role: 'input' | 'output';
    currency: string;
    debit: string;
    credit: string;
    balance: string;
    signedVat: string;
  }[];
  totalsByCurrency: {
    currency: string;
    outputVat: string;
    inputVat: string;
    netVat: string;
  }[];
  notice: string;
  officialReturn: false;
}

export async function vatControl(
  db: Db,
  companyId: string,
  from: string,
  to: string,
): Promise<VatControl> {
  const accounts = await db.query<any>(
    `SELECT id, code, name, account_role FROM accounts
      WHERE company_id = $1
        AND (account_role IN ('vat_input', 'vat_output')
             OR code IN ('1200', '2200')
             OR lower(name) LIKE '%tva%' OR lower(name) LIKE '%vat%')
      ORDER BY code`,
    [companyId],
  );
  const byId = new Map<string, any>(accounts.rows.map((a) => [a.id, a]));
  const rows = accounts.rows.length
    ? await db.query<any>(
        `SELECT l.account_id, e.currency,
                COALESCE(SUM(l.debit), 0)::text AS debit,
                COALESCE(SUM(l.credit), 0)::text AS credit
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = $1
          WHERE e.status = 'posted' AND e.entry_date BETWEEN $2 AND $3
            AND l.account_id = ANY($4::uuid[])
          GROUP BY l.account_id, e.currency
          ORDER BY l.account_id, e.currency`,
        [companyId, from, to, accounts.rows.map((a) => a.id)],
      )
    : { rows: [] };
  const resultRows: VatControl['accounts'] = [];
  for (const row of rows.rows) {
    const account = byId.get(row.account_id);
    if (!account) continue;
    const role =
      account.account_role === 'vat_input' || account.code === '1200' ? 'input' : 'output';
    const debit = parseAmount(row.debit);
    const credit = parseAmount(row.credit);
    // Input VAT is a debit balance; output VAT is a credit balance. Signed VAT
    // is positive when the company owes output VAT and negative when it has a
    // recoverable input balance.
    const signed = role === 'output' ? credit - debit : debit - credit;
    resultRows.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      role,
      currency: row.currency,
      debit: formatAmount(debit),
      credit: formatAmount(credit),
      balance: formatAmount(role === 'output' ? credit - debit : debit - credit),
      signedVat: formatAmount(signed),
    });
  }
  const currencies = [...new Set(resultRows.map((r) => r.currency))].sort();
  return {
    from,
    to,
    accounts: resultRows,
    totalsByCurrency: currencies.map((currency) => {
      const output = resultRows
        .filter((r) => r.currency === currency && r.role === 'output')
        .reduce((sum, r) => sum + parseAmount(r.signedVat), 0n);
      const input = resultRows
        .filter((r) => r.currency === currency && r.role === 'input')
        .reduce((sum, r) => sum + parseAmount(r.signedVat), 0n);
      return {
        currency,
        outputVat: formatAmount(output),
        inputVat: formatAmount(input),
        netVat: formatAmount(output - input),
      };
    }),
    notice:
      'État de contrôle fondé uniquement sur les écritures comptabilisées. Aucun taux, seuil, formulaire ou délai MRA n’est inventé ; ce document n’est pas une déclaration officielle.',
    officialReturn: false,
  };
}
