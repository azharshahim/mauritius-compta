import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  api,
  closeTestApp,
  createCompany,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
} from './helpers.js';
import { isCreditIndicator } from '../src/modules/migration/normalize.js';

/* -------------------------------------------------------------------------- */
/* Fixtures: every file below is explicitly fictional.                        */
/* -------------------------------------------------------------------------- */

const FR_CHART = [
  'Code;Intitulé;Type;Devise;Actif',
  '7001;Prestations de services (fictif);Produit;MUR;Oui',
  '7002;Charges externes (fictif);Charge;MUR;Oui',
  '7003;Compte inactif (fictif);Actif;MUR;Non',
].join('\r\n');

const EN_ENTRIES = [
  'Document Number,Posting Date,Account,Description,Debit,Credit,Currency',
  'INV-001,15/08/2025,1100,Client fictif,"1,234.56",,MUR',
  'INV-001,15/08/2025,4000,Vente fictive,,"1 234,56",MUR',
].join('\n');

/** Minimal but real XLSX container (two sheets), built at runtime. */
function buildXlsx(): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Lisez-moi" sheetId="1" r:id="rId1"/><sheet name="Plan" sheetId="2" r:id="rId2"/></sheets>
</workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;
  const sheet = (rows: string[][]) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (cells, r) =>
          `<row r="${r + 1}">${cells
            .map(
              (value, c) =>
                `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
            )
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/worksheets/sheet1.xml': strToU8(
      sheet([
        ['Fichier fictif de démonstration', 'Aucune donnée réelle'],
        ['Ce classeur est produit par les tests', 'Mission 8'],
      ]),
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      sheet([
        ['Code', 'Intitulé', 'Type'],
        ['7101', 'Matériel fictif', 'Actif'],
        ['7102', 'Amortissements fictifs', 'Passif'],
      ]),
    ),
  });
}

describe('migration assistant (mission 8)', () => {
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

  const freshCompany = async () => {
    const company = await createCompany(ctx, cookie);
    return company.id as string;
  };

  const upload = async (
    targetCompany: string,
    body: Record<string, unknown>,
  ) =>
    api(ctx, cookie, 'POST', `/api/companies/${targetCompany}/migration/jobs`, {
      sheetName: null,
      ...body,
    });

  const confirmImport = async (targetCompany: string, jobId: string) =>
    api(ctx, cookie, 'POST', `/api/companies/${targetCompany}/migration/jobs/${jobId}/import`, {
      confirm: true,
    });

  const count = async (sql: string, params: unknown[]) =>
    Number((await ctx.db.query<{ n: string | number }>(sql.replace('count(*)', 'count(*) AS n'), params)).rows[0]!.n);

  // -----------------------------------------------------------------------
  // 1. French CSV, semicolon, accented headers
  // -----------------------------------------------------------------------
  it('1. imports a French CSV chart of accounts end to end', async () => {
    const target = await freshCompany();
    const created = await upload(target, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'plan-comptable-fictif.csv',
      contentText: FR_CHART,
    });
    expect(created.statusCode).toBe(201);
    const view = created.json();
    expect(view.job.delimiter).toBe(';');
    expect(view.job.encoding).toBe('utf-8');
    expect(view.preview.mapping.code).toBe('Code');
    expect(view.preview.mapping.name).toBe('Intitulé');
    expect(view.preview.mapping.type).toBe('Type');
    expect(view.preview.summary.create).toBe(3);
    expect(view.preview.blocksImport).toBe(false);

    const imported = await confirmImport(target, view.job.id);
    expect(imported.statusCode).toBe(200);
    expect(imported.json().counts.created).toBe(3);

    const list = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${target}/accounts?includeInactive=true`,
    );
    const codes = (list.json().accounts as any[]).map((a) => a.code);
    expect(codes).toContain('7001');
    expect(codes).toContain('7003');
    const inactive = (list.json().accounts as any[]).find((a) => a.code === '7003');
    expect(inactive.is_active).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 2. English CSV, comma, quoted international amounts
  // -----------------------------------------------------------------------
  it('2. imports an English CSV with comma delimiter and international amounts', async () => {
    const target = await freshCompany();
    const created = await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'journal-fictif-en.csv',
      contentText: EN_ENTRIES,
    });
    expect(created.statusCode).toBe(201);
    const view = created.json();
    expect(view.job.delimiter).toBe(',');
    expect(view.preview.mapping.entryKey).toBe('Document Number');
    expect(view.preview.mapping.entryDate).toBe('Posting Date');
    expect(view.preview.rows.entries[0].debitTotal).toBe('1234.5600');
    expect(view.preview.blocksImport).toBe(false);

    const imported = await confirmImport(target, view.job.id);
    expect(imported.statusCode).toBe(200);
    expect(imported.json().counts.entries).toBe(1);

    const entries = await api(ctx, cookie, 'GET', `/api/companies/${target}/entries`);
    const list = entries.json().entries as any[];
    expect(list).toHaveLength(1);
    expect(list[0].reference).toBe('INV-001');
    expect(list[0].source).toBe('migration');
  });

  // -----------------------------------------------------------------------
  // 3. Excel workbook, multiple sheets, explicit sheet selection
  // -----------------------------------------------------------------------
  it('3. reads a multi-sheet XLSX and imports the selected sheet', async () => {
    const target = await freshCompany();
    const base64 = Buffer.from(buildXlsx()).toString('base64');
    const created = await upload(target, {
      source: 'excel',
      importKind: 'chart_of_accounts',
      fileName: 'plan-fictif.xlsx',
      contentBase64: base64,
      sheetName: 'Plan',
    });
    expect(created.statusCode).toBe(201);
    const view = created.json();
    expect(view.sheets.map((s: any) => s.name)).toEqual(['Lisez-moi', 'Plan']);
    expect(view.sheet.name).toBe('Plan');
    expect(view.preview.mapping.code).toBe('Code');
    expect(view.preview.summary.create).toBe(2);

    const imported = await confirmImport(target, view.job.id);
    expect(imported.statusCode).toBe(200);
    const list = await api(ctx, cookie, 'GET', `/api/companies/${target}/accounts`);
    expect((list.json().accounts as any[]).map((a) => a.code)).toContain('7101');
  });

  // -----------------------------------------------------------------------
  // 4. Missing mandatory columns
  // -----------------------------------------------------------------------
  it('4. blocks an import when mandatory columns are missing', async () => {
    const target = await freshCompany();
    const created = await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'incomplet.csv',
      contentText: 'Compte;Libellé\n1100;Test\n',
    });
    expect(created.statusCode).toBe(201);
    const view = created.json();
    expect(view.preview.missingRequiredColumns.map((f: any) => f.field)).toEqual(
      expect.arrayContaining(['entryKey', 'entryDate']),
    );
    expect(view.preview.blocksImport).toBe(true);
    const imported = await confirmImport(target, view.job.id);
    expect(imported.statusCode).toBe(400);
    expect(imported.json().error.code).toBe('MIGRATION_BLOCKED');
  });

  // -----------------------------------------------------------------------
  // 5. Invalid dates
  // -----------------------------------------------------------------------
  it('5. reports invalid dates before any write', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'P-1;31/02/2025;1100;Date impossible;100,00;',
      'P-1;31/02/2025;4000;Date impossible;;100,00',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'dates-invalides.csv',
      contentText: content,
    })).json();
    expect(view.preview.findings.some((f: any) => f.code === 'INVALID_DATE')).toBe(true);
    expect(view.preview.blocksImport).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 6. Negative amounts
  // -----------------------------------------------------------------------
  it('6. rejects negative amounts instead of guessing a side', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'N-1;15/08/2025;1100;Montant négatif;-100,00;',
      'N-1;15/08/2025;4000;Montant négatif;;100,00',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'negatif.csv',
      contentText: content,
    })).json();
    expect(view.preview.findings.some((f: any) => f.code === 'NEGATIVE_AMOUNT')).toBe(true);

    const parenthesised = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'N-2;15/08/2025;1100;Crédit entre parenthèses;;"(100,00)"',
      'N-2;15/08/2025;4000;Contrepartie;100,00;',
    ].join('\n');
    const view2 = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'parentheses.csv',
      contentText: parenthesised,
    })).json();
    expect(view2.preview.findings.some((f: any) => f.code === 'NEGATIVE_AMOUNT')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 7. Unbalanced entry
  // -----------------------------------------------------------------------
  it('7. refuses an unbalanced entry and never fabricates a counterpart', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'U-1;15/08/2025;1100;Client;100,00;',
      'U-1;15/08/2025;4000;Vente;;90,00',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'desequilibre.csv',
      contentText: content,
    })).json();
    expect(view.preview.findings.some((f: any) => f.code === 'UNBALANCED_ENTRY')).toBe(true);
    const imported = await confirmImport(target, view.job.id);
    expect(imported.statusCode).toBe(400);
    expect(imported.json().error.code).toBe('MIGRATION_BLOCKED');
    expect(await count('SELECT count(*) FROM journal_entries WHERE company_id = $1', [target])).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 8. Unknown account, then explicit mapping
  // -----------------------------------------------------------------------
  it('8. blocks an unknown account, then accepts an explicit correspondence', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'M-1;15/08/2025;CLI001;Client;50,00;',
      'M-1;15/08/2025;VEN001;Vente;;50,00',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'comptes-inconnus.csv',
      contentText: content,
    })).json();
    expect(view.preview.findings.filter((f: any) => f.code === 'ACCOUNT_NOT_FOUND')).toHaveLength(2);
    expect(view.preview.blocksImport).toBe(true);

    const mapped = await api(
      ctx,
      cookie,
      'PUT',
      `/api/companies/${target}/migration/jobs/${view.job.id}/mapping`,
      { accountMapping: { CLI001: '1100', VEN001: '4000' } },
    );
    expect(mapped.statusCode).toBe(200);
    expect(mapped.json().preview.blocksImport).toBe(false);
    expect(mapped.json().preview.rows.entries[0].lines[0].viaMapping).toBe(true);

    const imported = await confirmImport(target, view.job.id);
    expect(imported.statusCode).toBe(200);
    expect(imported.json().counts.entries).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 9. Duplicate account code in the source file
  // -----------------------------------------------------------------------
  it('9. detects a duplicate account code in the file', async () => {
    const target = await freshCompany();
    const content = [
      'Code;Intitulé;Type',
      '7201;Compte fictif A;Actif',
      '7201;Compte fictif B;Passif',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'doublon-compte.csv',
      contentText: content,
    })).json();
    expect(view.preview.findings.some((f: any) => f.code === 'DUPLICATE_ACCOUNT_CODE')).toBe(true);
    expect(view.preview.blocksImport).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 10 + 11. Duplicate entry in file, then re-import of the same file
  // -----------------------------------------------------------------------
  it('10. flags two identical entries in the same file', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'D-1;15/09/2025;1100;Client;75,00;',
      'D-1;15/09/2025;4000;Vente;;75,00',
      'D-2;15/09/2025;1100;Client;75,00;',
      'D-2;15/09/2025;4000;Vente;;75,00',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'doublon-ecriture.csv',
      contentText: content,
    })).json();
    expect(view.preview.findings.some((f: any) => f.code === 'DUPLICATE_ENTRY_IN_FILE')).toBe(true);
    // A warning does not block: the user still sees both documents.
    expect(view.preview.blocksImport).toBe(false);
    expect(view.preview.rows.entries).toHaveLength(2);
  });

  it('11. re-importing the same file never duplicates a posted entry', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'R-1;15/08/2025;1100;Client;120,00;',
      'R-1;15/08/2025;4000;Vente;;120,00',
    ].join('\n');
    const first = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'reimport.csv',
      contentText: content,
    })).json();
    expect((await confirmImport(target, first.job.id)).statusCode).toBe(200);
    expect(await count('SELECT count(*) FROM journal_entries WHERE company_id = $1', [target])).toBe(1);

    const second = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'reimport.csv',
      contentText: content,
    })).json();
    expect(second.job.idempotency_key).toBe(first.job.idempotency_key);
    expect(second.preview.rows.entries[0].action).toBe('skip');
    const imported = await confirmImport(target, second.job.id);
    expect(imported.statusCode).toBe(200);
    expect(imported.json().counts.created).toBe(0);
    expect(imported.json().counts.skipped).toBe(1);
    expect(await count('SELECT count(*) FROM journal_entries WHERE company_id = $1', [target])).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 12. Interrupted import then resume
  // -----------------------------------------------------------------------
  it('12. resumes after an interruption without a partial write', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit',
      'I-1;15/08/2025;1100;Client;200,00;',
      'I-1;15/08/2025;4000;Vente;;200,00',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'interruption.csv',
      contentText: content,
    })).json();

    await ctx.db.query(
      `UPDATE accounting_periods SET status = 'closed' WHERE company_id = $1`,
      [target],
    );
    const failed = await confirmImport(target, view.job.id);
    expect([400, 409]).toContain(failed.statusCode);
    expect(await count('SELECT count(*) FROM journal_entries WHERE company_id = $1', [target])).toBe(0);
    const jobAfter = await ctx.db.query<{ status: string }>(
      'SELECT status FROM migration_jobs WHERE id = $1',
      [view.job.id],
    );
    expect(jobAfter.rows[0]!.status).toBe('failed');

    await ctx.db.query(
      `UPDATE accounting_periods SET status = 'open' WHERE company_id = $1`,
      [target],
    );
    const resumed = await confirmImport(target, view.job.id);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().counts.created).toBe(1);
    expect(await count('SELECT count(*) FROM journal_entries WHERE company_id = $1', [target])).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 13. Opening balance
  // -----------------------------------------------------------------------
  it('13. posts a balanced opening balance through the accounting engine', async () => {
    const target = await freshCompany();
    const content = [
      'Compte;Débit;Crédit;Libellé',
      '1100;1500,00;;Clients à nouveau',
      '4000;;1500,00;Produits à nouveau',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'opening_balance',
      fileName: 'balance-ouverture.csv',
      contentText: content,
      options: { openingDate: '2025-07-01', defaultJournalCode: 'OD' },
    })).json();
    expect(view.preview.totals).toEqual({
      debit: '1500.0000',
      credit: '1500.0000',
      difference: '0.0000',
    });
    const imported = await confirmImport(target, view.job.id);
    expect(imported.statusCode).toBe(200);

    const entry = await ctx.db.query<{ source: string; entry_no: string }>(
      `SELECT source, entry_no FROM journal_entries WHERE company_id = $1`,
      [target],
    );
    expect(entry.rows).toHaveLength(1);
    expect(entry.rows[0]!.source).toBe('migration_opening');
    expect(entry.rows[0]!.entry_no).toMatch(/\d/);

    // An unbalanced opening balance is refused, never silently completed.
    const other = await freshCompany();
    const bad = (await upload(other, {
      source: 'csv',
      importKind: 'opening_balance',
      fileName: 'balance-incoherente.csv',
      contentText: 'Compte;Débit;Crédit\n1100;900,00;\n4000;;800,00',
      options: { openingDate: '2025-07-01' },
    })).json();
    expect(bad.preview.findings.some((f: any) => f.code === 'OPENING_UNBALANCED')).toBe(true);
    expect((await confirmImport(other, bad.job.id)).statusCode).toBe(400);
  });

  // -----------------------------------------------------------------------
  // 14. Multi-currency
  // -----------------------------------------------------------------------
  it('14. imports a foreign-currency entry with its explicit rate', async () => {
    const target = await freshCompany();
    const content = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit;Devise;Taux',
      'EUR-1;15/08/2025;1100;Client EUR;100,00;;EUR;48,50000000',
      'EUR-1;15/08/2025;4000;Vente EUR;;100,00;EUR;48,50000000',
    ].join('\n');
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'devises.csv',
      contentText: content,
    })).json();
    expect(view.preview.blocksImport).toBe(false);
    expect(view.preview.rows.entries[0].currency).toBe('EUR');
    expect((await confirmImport(target, view.job.id)).statusCode).toBe(200);
    const entry = await ctx.db.query<{ currency: string; exchange_rate: string }>(
      'SELECT currency, exchange_rate FROM journal_entries WHERE company_id = $1',
      [target],
    );
    expect(entry.rows[0]!.currency).toBe('EUR');
    expect(Number(entry.rows[0]!.exchange_rate)).toBe(48.5);

    const missing = [
      'Pièce;Date;Compte;Libellé;Débit;Crédit;Devise',
      'EUR-2;15/08/2025;1100;Client EUR;100,00;;EUR',
      'EUR-2;15/08/2025;4000;Vente EUR;;100,00;EUR',
    ].join('\n');
    const other = await freshCompany();
    const bad = (await upload(other, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'devise-sans-taux.csv',
      contentText: missing,
    })).json();
    expect(bad.preview.findings.some((f: any) => f.code === 'EXCHANGE_RATE_REQUIRED')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 15 + 16. Authorisation and isolation
  // -----------------------------------------------------------------------
  it('15. refuses a company the user is not a member of', async () => {
    const target = await freshCompany();
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'plan.csv',
      contentText: 'Code;Intitulé;Type\n7301;Compte fictif;Actif',
    })).json();
    const outsider = await registerUser(ctx);
    const res = await api(
      ctx,
      outsider.cookie,
      'GET',
      `/api/companies/${target}/migration/jobs/${view.job.id}`,
    );
    expect(res.statusCode).toBe(404);
    const attempt = await api(
      ctx,
      outsider.cookie,
      'POST',
      `/api/companies/${target}/migration/jobs/${view.job.id}/import`,
      { confirm: true },
    );
    expect(attempt.statusCode).toBe(404);
  });

  it('16. isolates saved mappings per cabinet', async () => {
    const target = await freshCompany();
    const created = await api(ctx, cookie, 'POST', `/api/companies/${target}/migration/templates`, {
      name: 'Modèle plan comptable (fictif)',
      importKind: 'chart_of_accounts',
      source: 'csv',
      mapping: { code: 'Code', name: 'Intitulé', type: 'Type' },
    });
    expect(created.statusCode).toBe(201);

    const outsider = await registerUser(ctx);
    const ownCompany = await createCompany(ctx, outsider.cookie);
    const theirs = await api(
      ctx,
      outsider.cookie,
      'GET',
      `/api/companies/${ownCompany.id}/migration/templates`,
    );
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json().templates).toEqual([]);

    const mine = await api(ctx, cookie, 'GET', `/api/companies/${target}/migration/templates`);
    expect(mine.json().templates).toHaveLength(1);
    expect(mine.json().templates[0].name).toContain('fictif');
  });

  // -----------------------------------------------------------------------
  // 17. Multi-company batch
  // -----------------------------------------------------------------------
  it('17. never assigns a company automatically and creates only explicitly allowed ones', async () => {
    const target = await freshCompany();
    const content = [
      'Nom;BRN;Devise;Début exercice;Fin exercice',
      'Alpha Fictive Ltd;BRN-ALPHA-FICTIF;MUR;01/07/2025;30/06/2026',
      'Beta Fictive Ltd;BRN-BETA-FICTIF;EUR;01/07/2025;30/06/2026',
    ].join('\n');
    const blocked = (await upload(target, {
      source: 'csv',
      importKind: 'companies',
      fileName: 'societes.csv',
      contentText: content,
    })).json();
    expect(blocked.preview.findings.some((f: any) => f.code === 'COMPANY_CREATION_NOT_ALLOWED')).toBe(true);
    expect(blocked.preview.blocksImport).toBe(true);

    const allowed = await api(
      ctx,
      cookie,
      'PUT',
      `/api/companies/${target}/migration/jobs/${blocked.job.id}/mapping`,
      { options: { createCompanies: true } },
    );
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().preview.blocksImport).toBe(false);
    const imported = await confirmImport(target, blocked.job.id);
    expect(imported.statusCode).toBe(200);
    expect(imported.json().counts.companies).toBe(2);

    const created = await ctx.db.query<{ cabinet_id: string; name: string }>(
      `SELECT cabinet_id, name FROM companies WHERE brn = 'BRN-ALPHA-FICTIF'`,
    );
    expect(created.rows[0]!.cabinet_id).toBe(
      (await ctx.db.query<{ cabinet_id: string }>('SELECT cabinet_id FROM companies WHERE id = $1', [
        target,
      ])).rows[0]!.cabinet_id,
    );

    // Re-running the same file skips both companies: no duplicate dossier.
    const again = (await upload(target, {
      source: 'csv',
      importKind: 'companies',
      fileName: 'societes.csv',
      contentText: content,
      options: { createCompanies: true },
    })).json();
    expect(again.preview.summary.skip).toBe(2);
    expect(await count(`SELECT count(*) FROM companies WHERE brn LIKE 'BRN-%FICTIF'`, [])).toBe(2);
  });

  // -----------------------------------------------------------------------
  // 18. No import without explicit human confirmation
  // -----------------------------------------------------------------------
  it('18. refuses an import without the explicit confirmation flag', async () => {
    const target = await freshCompany();
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'plan.csv',
      contentText: 'Code;Intitulé;Type\n7401;Compte fictif;Actif',
    })).json();
    const noConfirm = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${target}/migration/jobs/${view.job.id}/import`,
      {},
    );
    expect(noConfirm.statusCode).toBe(400);
    const falseConfirm = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${target}/migration/jobs/${view.job.id}/import`,
      { confirm: false },
    );
    expect(falseConfirm.statusCode).toBe(400);
    expect(await count('SELECT count(*) FROM accounts WHERE company_id = $1 AND code = $2', [
      target,
      '7401',
    ])).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 19. Preview creates no accounting data
  // -----------------------------------------------------------------------
  it('19. never writes accounting data during upload, mapping or preview', async () => {
    const target = await freshCompany();
    const before = {
      accounts: await count('SELECT count(*) FROM accounts WHERE company_id = $1', [target]),
      entries: await count('SELECT count(*) FROM journal_entries WHERE company_id = $1', [target]),
      customers: await count('SELECT count(*) FROM billing_customers WHERE company_id = $1', [target]),
    };
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'apercu.csv',
      contentText: [
        'Pièce;Date;Compte;Libellé;Débit;Crédit',
        'P-1;15/08/2025;1100;Client;300,00;',
        'P-1;15/08/2025;4000;Vente;;300,00',
      ].join('\n'),
    })).json();
    const previewAgain = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${target}/migration/jobs/${view.job.id}`,
    );
    expect(previewAgain.statusCode).toBe(200);
    expect(previewAgain.json().preview.blocksImport).toBe(false);
    expect(await count('SELECT count(*) FROM accounts WHERE company_id = $1', [target])).toBe(before.accounts);
    expect(await count('SELECT count(*) FROM journal_entries WHERE company_id = $1', [target])).toBe(before.entries);
    expect(await count('SELECT count(*) FROM billing_customers WHERE company_id = $1', [target])).toBe(
      before.customers,
    );
  });

  // -----------------------------------------------------------------------
  // 20. Non-regression of the existing accounting paths
  // -----------------------------------------------------------------------
  it('20. keeps the manual accounting paths unchanged', async () => {
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journals.find((j) => j.code === 'OD')!.id,
      entryDate: '2025-08-20',
      description: 'Écriture manuelle de non-régression (fictive)',
      reference: 'MAN-001',
      lines: [
        { accountId: accounts.find((a) => a.code === '1100')!.id, debit: '10.0000' },
        { accountId: accounts.find((a) => a.code === '4000')!.id, credit: '10.0000' },
      ],
      status: 'posted',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().entry.source).toBe('manual');

    const duplicateAccount = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/accounts`, {
      code: '1000',
      name: 'Doublon',
      type: 'asset',
    });
    expect(duplicateAccount.statusCode).toBe(409);
    expect(duplicateAccount.json().error.code).toBe('ACCOUNT_CODE_TAKEN');
  });

  it('maps SAP SHKZG indicators without flipping debit and credit', () => {
    // S = Soll = debit, H = Haben = credit. A wrong mapping would post every
    // SAP line on the same side (regression covered after mission 8 review).
    expect(isCreditIndicator('S')).toBe(false);
    expect(isCreditIndicator('H')).toBe(true);
    expect(isCreditIndicator('Soll')).toBe(false);
    expect(isCreditIndicator('Haben')).toBe(true);
    expect(isCreditIndicator('D')).toBe(false);
    expect(isCreditIndicator('C')).toBe(true);
    expect(isCreditIndicator('?')).toBeNull();
  });

  it('rejects a workbook containing macros and an unsupported extension', async () => {
    const target = await freshCompany();
    const macroless = (await upload(target, {
      source: 'other',
      importKind: 'chart_of_accounts',
      fileName: 'plan.xls',
      contentText: 'Code;Intitulé\n7501;Test',
    })).json();
    expect(macroless.preview).not.toBeNull();

    const badExtension = await upload(target, {
      source: 'other',
      importKind: 'chart_of_accounts',
      fileName: 'plan.xlsb',
      contentText: 'x',
    });
    expect(badExtension.statusCode).toBe(400);
    expect(badExtension.json().error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('downloads an injection-safe CSV report', async () => {
    const target = await freshCompany();
    const view = (await upload(target, {
      source: 'csv',
      importKind: 'customers',
      fileName: '=HYPERLINK("http://example.test").csv',
      contentText: [
        'Nom;Courriel;Adresse',
        'Client fictif;client@example.test;1 rue fictive',
      ].join('\n'),
    })).json();
    expect(view.preview.summary.create).toBe(1);
    expect((await confirmImport(target, view.job.id)).statusCode).toBe(200);
    const report = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${target}/migration/jobs/${view.job.id}/report.csv`,
    );
    expect(report.statusCode).toBe(200);
    expect(report.headers['content-type']).toContain('text/csv');
    // The file name starts with "=" ; the report must neutralise it.
    expect(report.body).toContain("'=HYPERLINK");
  });
});
