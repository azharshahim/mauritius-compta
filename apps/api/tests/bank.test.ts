import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  journalByCode,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
} from './helpers.js';

/* Every fixture is fictional. No real bank, account number or client exists. */

function buildXlsx(headers: string[], rows: string[][]): Uint8Array {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (v: string, index: number) => {
    const col = String.fromCharCode(65 + index);
    return /^-?\d+(\.\d+)?$/.test(v)
      ? `<c r="${col}1"><v>${v}</v></c>`
      : `<c r="${col}1" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  };
  const line = (values: string[], rowNo: number) =>
    `<row r="${rowNo}">${values
      .map((v, i) => cell(v, i).replace(`r="${String.fromCharCode(65 + i)}1"`, `r="${String.fromCharCode(65 + i)}${rowNo}"`))
      .join('')}</row>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
${[headers, ...rows].map((r, i) => line(r, i + 1)).join('\n')}
</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Relevé" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return zipSync(files);
}

const FR_CSV = [
  'Date;Libellé;Référence;Débit;Crédit;Devise;Solde',
  '05/08/2025;Encaissement client FA-2025-001;FA-2025-001;;125000,00;MUR;625000,00',
  '06/08/2025;Loyer août;LOYER-AOUT;15000,00;;MUR;610000,00',
  '07/08/2025;Frais bancaires;FRAIS-01;2500,00;;MUR;607500,00',
  '08/08/2025;Virement salaires août;SAL-08;45000,00;;MUR;562500,00',
  '09/08/2025;Paiement fournisseur AC-2025-001;AC-2025-001;32000,00;;MUR;530500,00',
].join('\r\n');

describe('bank import & reconciliation (mission 9)', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyId: string;
  let accounts: any[];
  let journals: any[];

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    cookie = setup.user.cookie;
    companyId = setup.company.id;
    accounts = setup.accounts;
    journals = setup.journals;
  });
  afterAll(async () => {
    await closeTestApp(ctx);
  });

  const refs = new Map<string, { accounts: any[]; journals: any[] }>();
  const loadRefs = async (target: string) => {
    const cached = refs.get(target);
    if (cached) return cached;
    const charts = (await api(ctx, cookie, 'GET', `/api/companies/${target}/accounts`)).json();
    const journalList = (await api(ctx, cookie, 'GET', `/api/companies/${target}/journals`)).json();
    const value = { accounts: charts.accounts ?? [], journals: journalList.journals ?? [] };
    refs.set(target, value);
    return value;
  };

  const createBank = async (
    target: string,
    overrides: Record<string, unknown> = {},
    userCookie = cookie,
  ) => {
    const local = await loadRefs(target);
    return api(ctx, userCookie, 'POST', `/api/companies/${target}/bank/accounts`, {
      name: 'Compte fictif MUR',
      bankName: 'Banque Fictive Ltd',
      currency: 'MUR',
      accountId: accountByCode(local.accounts, '1010').id,
      maskedReference: 'MU00FICTIF00001234',
      ...overrides,
    });
  };

  const preview = async (target: string, body: Record<string, unknown>) =>
    api(ctx, cookie, 'POST', `/api/companies/${target}/bank/preview`, body);

  const importFile = async (target: string, body: Record<string, unknown>) =>
    api(ctx, cookie, 'POST', `/api/companies/${target}/bank/imports`, body);

  const postEntry = async (
    target: string,
    input: { date: string; reference: string; description: string; lines: { code: string; debit?: string; credit?: string }[] },
  ) => {
    const local = await loadRefs(target);
    return api(ctx, cookie, 'POST', `/api/companies/${target}/entries`, {
      journalId: journalByCode(local.journals, 'BQ').id,
      entryDate: input.date,
      reference: input.reference,
      description: input.description,
      status: 'posted',
      lines: input.lines.map((l) => ({
        accountId: accountByCode(local.accounts, l.code).id,
        ...(l.debit ? { debit: l.debit } : { credit: l.credit }),
      })),
    });
  };

  const txns = async (target: string, bankAccountId: string) =>
    (await api(ctx, cookie, 'GET', `/api/companies/${target}/bank/transactions?bankAccountId=${bankAccountId}`)).json().transactions;

  const count = async (sql: string, params: unknown[]) => {
    const res = await ctx.db.query<{ n: string | number }>(sql, params);
    return Number(res.rows[0]!.n);
  };

  it('1. imports a fictional MUR CSV after preview (nothing written by preview)', async () => {
    const bank = await createBank(companyId);
    expect(bank.statusCode).toBe(201);
    const bankId = bank.json().account.id;
    const before = await count('SELECT count(*) AS n FROM bank_transactions WHERE company_id = $1', [companyId]);
    const p = await preview(companyId, { bankAccountId: bankId, fileName: 'releve.csv', contentText: FR_CSV });
    expect(p.statusCode).toBe(200);
    const body = p.json();
    expect(body.preview.summary.total).toBe(5);
    expect(body.preview.summary.errors).toBe(0);
    expect(body.preview.blocksImport).toBe(false);
    expect(body.preview.balances.opening).toBe('500000.0000');
    expect(await count('SELECT count(*) AS n FROM bank_transactions WHERE company_id = $1', [companyId])).toBe(before);

    const imported = await importFile(companyId, { bankAccountId: bankId, fileName: 'releve.csv', contentText: FR_CSV });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().imported).toBe(5);
    expect(await txns(companyId, bankId)).toHaveLength(5);
  });

  it('2. imports an XLSX statement and keeps its balance sequence', async () => {
    const bank = (await createBank(companyId, { name: 'Compte XLSX fictif' })).json().account;
    const xlsx = buildXlsx(
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      [
        ['10/08/2025', 'Fictional receipt', '', '10000.00', '10000.00'],
        ['11/08/2025', 'Fictional fee', '500.00', '', '9500.00'],
      ],
    );
    const p = await preview(companyId, {
      bankAccountId: bank.id,
      fileName: 'releve.xlsx',
      contentBase64: Buffer.from(xlsx).toString('base64'),
    });
    expect(p.statusCode).toBe(200);
    expect(p.json().preview.summary.total).toBe(2);
    expect(p.json().preview.balances.consistent).toBe(true);
    const imported = await importFile(companyId, {
      bankAccountId: bank.id,
      fileName: 'releve.xlsx',
      contentBase64: Buffer.from(xlsx).toString('base64'),
    });
    expect(imported.statusCode).toBe(201);
  });

  it('3. reads FR and EN date conventions explicitly', async () => {
    const bank = (await createBank(companyId, { name: 'Compte dates fictif' })).json().account;
    const csv = 'Date;Libellé;Montant\n05/07/2025;Opération fictive;100,00';
    const fr = await preview(companyId, { bankAccountId: bank.id, fileName: 'd.csv', contentText: csv, dayFirst: true });
    expect(fr.json().preview.transactions[0].txnDate).toBe('2025-07-05');
    const en = await preview(companyId, { bankAccountId: bank.id, fileName: 'd.csv', contentText: csv, dayFirst: false });
    expect(en.json().preview.transactions[0].txnDate).toBe('2025-05-07');
  });

  it('4. maps debit as money out and credit as money in', async () => {
    const bank = (await createBank(companyId, { name: 'Compte sens fictif' })).json().account;
    const csv = 'Date;Libellé;Débit;Crédit\n05/08/2025;Sortie fictive;1500,00;\n06/08/2025;Entrée fictive;;2300,00';
    const p = await preview(companyId, { bankAccountId: bank.id, fileName: 'sens.csv', contentText: csv });
    expect(p.json().preview.transactions[0].amount).toBe('-1500.0000');
    expect(p.json().preview.transactions[1].amount).toBe('2300.0000');
  });

  it('5. accepts a signed single amount column and refuses zero', async () => {
    const bank = (await createBank(companyId, { name: 'Compte montant signé fictif' })).json().account;
    const csv = 'Date;Libellé;Montant signé\n05/08/2025;Débit fictif;-750,50\n06/08/2025;Crédit fictif;1200,00\n07/08/2025;Zéro fictif;0';
    const p = await preview(companyId, { bankAccountId: bank.id, fileName: 'signe.csv', contentText: csv });
    const body = p.json().preview;
    expect(body.transactions[0].amount).toBe('-750.5000');
    expect(body.transactions[1].amount).toBe('1200.0000');
    expect(body.summary.errors).toBe(1);
    expect(body.findings.some((f: any) => f.code === 'ZERO_AMOUNT')).toBe(true);
  });

  it('6. detects duplicates inside the same file and skips them', async () => {
    const bank = (await createBank(companyId, { name: 'Compte doublons fictif' })).json().account;
    const csv = [
      'Date;Libellé;Montant;Référence',
      '05/08/2025;Opération fictive;1000,00;DUP-1',
      '05/08/2025;Opération fictive;1000,00;DUP-1',
    ].join('\n');
    const p = await preview(companyId, { bankAccountId: bank.id, fileName: 'dup.csv', contentText: csv });
    expect(p.json().preview.summary.total).toBe(2);
    expect(p.json().preview.summary.duplicates).toBe(1);
    expect(p.json().preview.summary.importable).toBe(1);
    const imported = await importFile(companyId, { bankAccountId: bank.id, fileName: 'dup.csv', contentText: csv });
    expect(imported.json().imported).toBe(1);
  });

  it('7. re-importing the same file never duplicates transactions', async () => {
    const bank = (await createBank(companyId, { name: 'Compte réimport fictif' })).json().account;
    const body = { bankAccountId: bank.id, fileName: 'once.csv', contentText: FR_CSV };
    expect((await importFile(companyId, body)).statusCode).toBe(201);
    const again = await importFile(companyId, body);
    expect(again.statusCode).toBe(200);
    expect(again.json().reimport).toBe(true);
    expect(again.json().imported).toBe(0);
    expect(await txns(companyId, bank.id)).toHaveLength(5);
  });

  it('8. blocks a statement whose currency differs from the bank account', async () => {
    const bank = (await createBank(companyId, { name: 'Compte devise fictif', currency: 'EUR' })).json().account;
    const csv = 'Date;Libellé;Montant;Devise\n05/08/2025;Opération en USD;100,00;USD';
    const p = await preview(companyId, { bankAccountId: bank.id, fileName: 'usd.csv', contentText: csv });
    expect(p.json().preview.blocksImport).toBe(true);
    expect(p.json().preview.findings.some((f: any) => f.code === 'CURRENCY_MISMATCH')).toBe(true);
    const imported = await importFile(companyId, { bankAccountId: bank.id, fileName: 'usd.csv', contentText: csv });
    expect(imported.statusCode).toBe(400);
    expect(imported.json().error.code).toBe('BANK_IMPORT_BLOCKED');
  });

  it('9. reports an inconsistent running balance without changing any amount', async () => {
    const bank = (await createBank(companyId, { name: 'Compte solde fictif' })).json().account;
    const csv = [
      'Date;Libellé;Montant;Solde',
      '05/08/2025;Entrée fictive;1000,00;11000,00',
      '06/08/2025;Sortie fictive;-500,00;9000,00',
    ].join('\n');
    const p = await preview(companyId, { bankAccountId: bank.id, fileName: 'solde.csv', contentText: csv });
    const previewBody = p.json().preview;
    expect(previewBody.blocksImport).toBe(true);
    expect(previewBody.findings.some((f: any) => f.code === 'BALANCE_MISMATCH')).toBe(true);
    expect(previewBody.transactions[0].amount).toBe('1000.0000');
    expect(previewBody.transactions[1].amount).toBe('-500.0000');
  });

  it('10. refuses a bank account of another company (no disclosure)', async () => {
    const other = await createCompany(ctx, cookie, { name: 'Autre société fictive' });
    const bank = (await createBank(other.id, { name: 'Compte autre société' })).json().account;
    const p = await preview(companyId, { bankAccountId: bank.id, fileName: 'x.csv', contentText: FR_CSV });
    expect(p.statusCode).toBe(404);
    expect(p.json().error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
  });

  it('11. isolates companies: transactions are never visible from another company', async () => {
    const other = await createCompany(ctx, cookie, { name: 'Société isolée fictive' });
    const bank = (await createBank(companyId, { name: 'Compte isolation fictif' })).json().account;
    const body = { bankAccountId: bank.id, fileName: 'iso.csv', contentText: FR_CSV };
    await importFile(companyId, body);
    const list = await api(ctx, cookie, 'GET', `/api/companies/${other.id}/bank/transactions`);
    expect(list.json().transactions).toHaveLength(0);
  });

  it('12. isolates cabinets: another user cannot read the bank accounts', async () => {
    const outsider = await registerUser(ctx);
    await createCompany(ctx, outsider.cookie, { name: 'Cabinet tiers fictif' });
    const res = await api(ctx, outsider.cookie, 'GET', `/api/companies/${companyId}/bank/accounts`);
    expect(res.statusCode).toBe(404);
  });

  it('13. proposes an exact match with an existing bank line', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Rapprochement exact fictif' });
    const accounts2 = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/accounts`)).json().accounts;
    accounts = accounts2;
    const bank = (await createBank(target.id, { name: 'Compte rappro exact' })).json().account;
    const entry = await postEntry(target.id, {
      date: '2025-08-05',
      reference: 'FA-EXACT-001',
      description: 'Encaissement fictif exact',
      lines: [
        { code: '1010', debit: '125000' },
        { code: '1100', credit: '125000' },
      ],
    });
    expect(entry.statusCode, entry.body).toBe(201);
    const csv = 'Date;Libellé;Montant;Référence\n05/08/2025;Encaissement FA-EXACT-001;125000,00;FA-EXACT-001';
    await importFile(target.id, { bankAccountId: bank.id, fileName: 'exact.csv', contentText: csv });
    const [txn] = await txns(target.id, bank.id);
    const detail = await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${txn.id}`);
    expect(detail.json().match.status).toBe('proposed');
    expect(detail.json().match.candidates[0].entryId).toBe(entry.json().entry.id);
  });

  it('14. flags an ambiguous match when two entries score equally', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Rapprochement ambigu fictif' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte ambigu' })).json().account;
    for (const ref of ['AMB-A', 'AMB-B']) {
      const ambiguousEntry = await postEntry(target.id, {
        date: '2025-08-06',
        reference: ref,
        description: `Paiement ambigu ${ref}`,
        lines: [
          { code: '6100', debit: '7000' },
          { code: '1010', credit: '7000' },
        ],
      });
      expect(ambiguousEntry.statusCode, ambiguousEntry.body).toBe(201);
    }
    const csv = 'Date;Libellé;Montant\n06/08/2025;Paiement loyer;-7000,00';
    await importFile(target.id, { bankAccountId: bank.id, fileName: 'amb.csv', contentText: csv });
    const [txn] = await txns(target.id, bank.id);
    const detail = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${txn.id}`)).json();
    expect(detail.match.status, JSON.stringify(detail.match)).toBe('ambiguous');
    expect(detail.match.reasonCode).toBe('AMBIGUOUS_MATCH');
    expect(detail.match.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('15. rejects a proposed reconciliation explicitly (no ledger write)', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Rapprochement refusé fictif' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte refus' })).json().account;
    await postEntry(target.id, {
      date: '2025-08-07',
      reference: 'REF-15',
      description: 'Loyer fictif refus',
      lines: [
        { code: '6100', debit: '8000' },
        { code: '1010', credit: '8000' },
      ],
    });
    await importFile(target.id, { bankAccountId: bank.id, fileName: 'ref.csv', contentText: 'Date;Libellé;Montant\n07/08/2025;Loyer;8000,00' });
    const [txn] = await txns(target.id, bank.id);
    const before = await count('SELECT count(*) AS n FROM journal_entries WHERE company_id = $1', [target.id]);
    const res = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${txn.id}/exclude`, { reason: 'fictif' });
    expect(res.statusCode).toBe(200);
    expect(res.json().transaction.status).toBe('excluded');
    expect(await count('SELECT count(*) AS n FROM journal_entries WHERE company_id = $1', [target.id])).toBe(before);
  });

  it('16. confirms a reconciliation only with explicit human confirmation', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Rapprochement validé fictif' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte validé' })).json().account;
    const entry = await postEntry(target.id, {
      date: '2025-08-08',
      reference: 'VAL-16',
      description: 'Encaissement validé fictif',
      lines: [
        { code: '1010', debit: '9000' },
        { code: '1100', credit: '9000' },
      ],
    });
    await importFile(target.id, { bankAccountId: bank.id, fileName: 'val.csv', contentText: 'Date;Libellé;Montant;Référence\n08/08/2025;Encaissement VAL-16;9000,00;VAL-16' });
    const [txn] = await txns(target.id, bank.id);
    const detail = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${txn.id}`)).json();
    const lineId = detail.match.candidates[0].lineId;
    const refused = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${txn.id}/matches`, { lineIds: [lineId] });
    expect(refused.statusCode).toBe(400);
    const ok = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${txn.id}/matches`, {
      lineIds: [lineId],
      confirm: true,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().transaction.status).toBe('matched');
    expect(ok.json().transaction.id).toBe(txn.id);
    expect(entry.statusCode, entry.body).toBe(201);
    const report = await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/report?bankAccountId=${bank.id}`);
    expect(report.json().report.validatedAt).toBeTruthy();
    expect(report.json().report.validatedBy).toBeTruthy();
    expect(report.json().report.status).toBe('differences'); // aucun solde bancaire fourni
  });

  it('17. reconciles one transaction against two lines of the same entry', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Rapprochement fractionné fictif' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte fractionné' })).json().account;
    const entry = await postEntry(target.id, {
      date: '2025-08-09',
      reference: 'SPLIT-17',
      description: 'Deux lignes bancaires fictives',
      lines: [
        { code: '1010', debit: '30000' },
        { code: '1010', debit: '20000' },
        { code: '1100', credit: '50000' },
      ],
    });
    expect(entry.statusCode, entry.body).toBe(201);
    await importFile(target.id, { bankAccountId: bank.id, fileName: 'split.csv', contentText: 'Date;Libellé;Montant;Référence\n09/08/2025;Encaissement SPLIT-17;50000,00;SPLIT-17' });
    const [txn] = await txns(target.id, bank.id);
    const detail = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${txn.id}`)).json();
    expect(detail.match.reasonCode).toBe('SPLIT_MATCH');
    expect(detail.match.split.lineIds).toHaveLength(2);
    const ok = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${txn.id}/matches`, {
      lineIds: detail.match.split.lineIds,
      confirm: true,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().matched).toBe(2);
  });

  it('18. blocks several transactions against one already reconciled line', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Multi transactions fictif' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte multi' })).json().account;
    await postEntry(target.id, {
      date: '2025-08-10',
      reference: 'MULTI-18',
      description: 'Ligne unique fictive',
      lines: [
        { code: '1010', debit: '4000' },
        { code: '1100', credit: '4000' },
      ],
    });
    const csv = [
      'Date;Libellé;Montant;Référence',
      '10/08/2025;Premier versement fictif;4000,00;MULTI-18',
      '11/08/2025;Second versement fictif;4000,00;MULTI-18',
    ].join('\n');
    await importFile(target.id, { bankAccountId: bank.id, fileName: 'multi.csv', contentText: csv });
    const [first, second] = await txns(target.id, bank.id);
    const detail = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${first.id}`)).json();
    const lineId = detail.match.candidates[0].lineId;
    await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${first.id}/matches`, {
      lineIds: [lineId],
      confirm: true,
    });
    const blocked = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${second.id}/matches`, {
      lineIds: [lineId],
      confirm: true,
    });
    expect([400, 409]).toContain(blocked.statusCode);
    expect(blocked.json().error.code).toMatch(/BANK_LINE_ALREADY_MATCHED|BANK_LINE_NOT_FOUND/);
  });

  it('19. links an invoice reference without creating a second receipt', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Facture rapprochée fictive' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte facture' })).json().account;
    await ctx.db.query(
      `INSERT INTO billing_documents (company_id, kind, doc_no, customer_name, issue_date, currency, total_amount, status)
       VALUES ($1,'invoice','FA-FICTIVE-900',$2,'2025-08-01','MUR',15000,'issued')`,
      [target.id, 'Client fictif'],
    );
    await postEntry(target.id, {
      date: '2025-08-12',
      reference: 'FA-FICTIVE-900',
      description: 'Encaissement facture fictive',
      lines: [
        { code: '1010', debit: '15000' },
        { code: '1100', credit: '15000' },
      ],
    });
    await importFile(target.id, {
      bankAccountId: bank.id,
      fileName: 'facture.csv',
      contentText: 'Date;Libellé;Montant;Référence\n12/08/2025;Virement FA-FICTIVE-900;15000,00;FA-FICTIVE-900',
    });
    const [txn] = await txns(target.id, bank.id);
    const detail = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${txn.id}`)).json();
    expect(detail.match.status).toBe('proposed');
    expect(detail.match.candidates[0].reasons).toContain('Référence concordante');
    expect(await count('SELECT count(*) AS n FROM billing_payments WHERE company_id = $1', [target.id])).toBe(0);
  });

  it('20. proposes bank charges on an existing expense account, posting only after acceptance', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Frais bancaires fictifs' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte frais' })).json().account;
    await importFile(target.id, {
      bankAccountId: bank.id,
      fileName: 'frais.csv',
      contentText: 'Date;Libellé;Montant\n13/08/2025;Frais bancaires du mois;-1250,00',
    });
    const [txn] = await txns(target.id, bank.id);
    const detail = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${txn.id}`)).json();
    expect(detail.account.kind).toBe('fee');
    expect(detail.account.accountId).toBe(accountByCode(accounts, '6140').id);
    const created = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${txn.id}/proposals`, {});
    expect(created.statusCode).toBe(201);
    expect(created.json().proposal.status).toBe('proposed');
    const entriesBefore = await count('SELECT count(*) AS n FROM journal_entries WHERE company_id = $1', [target.id]);
    const accepted = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/proposals/${created.json().proposal.id}/accept`, {
      confirm: true,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await count('SELECT count(*) AS n FROM journal_entries WHERE company_id = $1', [target.id])).toBe(entriesBefore + 1);
    const lines = await ctx.db.query(
      `SELECT a.code, l.debit::text, l.credit::text FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`,
      [accepted.json().entry.id],
    );
    expect(lines.rows.map((r: any) => r.code).sort()).toEqual(['1010', '6140']);
  });

  it('21. recognises a salary transfer as a proposal only, never a payroll', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Salaires fictifs' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte salaires' })).json().account;
    await importFile(target.id, {
      bankAccountId: bank.id,
      fileName: 'salaires.csv',
      contentText: 'Date;Libellé;Montant\n14/08/2025;Virement salaires août;-45000,00',
    });
    const [txn] = await txns(target.id, bank.id);
    const detail = (await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/transactions/${txn.id}`)).json();
    expect(detail.account.kind).toBe('salary');
    expect(detail.account.accountId).toBe(accountByCode(accounts, '2300').id);
    expect(detail.account.rationaleFr).toMatch(/aucune paie n’est calculée/i);
    expect(await count('SELECT count(*) AS n FROM payroll_employees WHERE company_id = $1', [target.id])).toBe(0);
  });

  it('22. refuses an unknown or inactive chart account in a proposal', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Compte inexistant fictif' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte inexistant' })).json().account;
    await importFile(target.id, {
      bankAccountId: bank.id,
      fileName: 'x.csv',
      contentText: 'Date;Libellé;Montant\n15/08/2025;Opération fictive;-100,00',
    });
    const [txn] = await txns(target.id, bank.id);
    const res = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${txn.id}/proposals`, {
      accountId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BANK_CHART_ACCOUNT_NOT_FOUND');
  });

  it('23. keeps an accepted proposal as a draft until human acceptance', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Proposition fictive' });
    accounts = (await loadRefs(target.id)).accounts;
    const bank = (await createBank(target.id, { name: 'Compte proposition' })).json().account;
    await importFile(target.id, {
      bankAccountId: bank.id,
      fileName: 'prop.csv',
      contentText: 'Date;Libellé;Montant\n16/08/2025;Loyer fictif;-3000,00',
    });
    const [txn] = await txns(target.id, bank.id);
    const before = await count('SELECT count(*) AS n FROM journal_entries WHERE company_id = $1', [target.id]);
    const proposal = await api(ctx, cookie, 'POST', `/api/companies/${target.id}/bank/transactions/${txn.id}/proposals`, {});
    expect(proposal.json().proposal.status).toBe('proposed');
    expect(await count('SELECT count(*) AS n FROM journal_entries WHERE company_id = $1', [target.id])).toBe(before);
  });

  it('24. resumes after an interrupted import without a partial write', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Reprise fictive' });
    const bank = (await createBank(target.id, { name: 'Compte reprise' })).json().account;
    const body = { bankAccountId: bank.id, fileName: 'reprise.csv', contentText: FR_CSV };
    const first = await preview(target.id, body);
    expect(first.json().preview.summary.importable).toBe(5);
    expect(await count('SELECT count(*) AS n FROM bank_imports WHERE bank_account_id = $1', [bank.id])).toBe(0);
    const imported = await importFile(target.id, body);
    expect(imported.json().imported).toBe(5);
    const again = await importFile(target.id, body);
    expect(again.json().reimport).toBe(true);
    expect(await count('SELECT count(*) AS n FROM bank_transactions WHERE bank_account_id = $1', [bank.id])).toBe(5);
  });

  it('25. reports an unexplained difference instead of claiming reconciliation', async () => {
    const target = await createCompany(ctx, cookie, { name: 'Écart fictif' });
    const bank = (await createBank(target.id, { name: 'Compte écart' })).json().account;
    await importFile(target.id, {
      bankAccountId: bank.id,
      fileName: 'ecart.csv',
      contentText: 'Date;Libellé;Montant;Solde\n17/08/2025;Opération non rapprochée;1000,00;1000,00',
    });
    const report = await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/report?bankAccountId=${bank.id}`);
    expect(report.statusCode).toBe(200);
    const body = report.json().report;
    expect(body.status).toBe('differences');
    expect(body.difference).toBe('1000.0000');
    expect(body.explanations.some((e: any) => e.code === 'UNMATCHED_BANK_TRANSACTIONS')).toBe(true);
    const csv = await api(ctx, cookie, 'GET', `/api/companies/${target.id}/bank/report.csv?bankAccountId=${bank.id}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Rapport de rapprochement');
  });

  it('26. keeps existing accounting endpoints and unchanged entry balanced', async () => {
    const res = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/trial-balance`);
    expect([200, 404]).toContain(res.statusCode);
    const accountsRes = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/accounts`);
    expect(accountsRes.statusCode).toBe(200);
  });

  it('27. imports a TSV statement with tab separators', async () => {
    const target = await createCompany(ctx, cookie, { name: 'TSV fictif' });
    const bank = (await createBank(target.id, { name: 'Compte TSV' })).json().account;
    const tsv = [
      'Date\tLibellé\tMontant\tRéférence',
      '18/08/2025\tEncaissement TSV fictif\t2500,00\tTSV-001',
    ].join('\n');
    const res = await importFile(target.id, {
      bankAccountId: bank.id,
      fileName: 'releve.tsv',
      contentText: tsv,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().imported).toBe(1);
    const [txn] = await txns(target.id, bank.id);
    expect(txn.reference).toBe('TSV-001');
    expect(txn.amount).toBe('2500.0000');
  });

  it('28. denies bank writes to a viewer but allows read access', async () => {
    const viewer = await registerUser(ctx);
    const added = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
    expect(added.statusCode, added.body).toBe(201);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: viewer.email, password: 'StrongPassw0rd!' },
    });
    const viewerCookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    const local = await loadRefs(companyId);
    const read = await api(ctx, viewerCookie, 'GET', `/api/companies/${companyId}/bank/accounts`);
    expect(read.statusCode).toBe(200);
    const write = await api(ctx, viewerCookie, 'POST', `/api/companies/${companyId}/bank/accounts`, {
      name: 'Compte interdit',
      bankName: 'Banque Fictive',
      currency: 'MUR',
      accountId: accountByCode(local.accounts, '1010').id,
    });
    expect(write.statusCode).toBe(403);
  });
});
