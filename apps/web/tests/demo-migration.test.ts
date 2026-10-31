/**
 * Démonstration navigateur — mission 8 (assistant de migration).
 *
 * Ces tests exercent exactement le code publié sur GitHub Pages : lecture réelle
 * des fichiers d'exemple fictifs (CSV/TSV/XLSX), moteur de contrôle partagé avec
 * l'API, prévisualisation sans écriture, import simulé idempotent. Aucun appel
 * réseau n'est effectué.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const samplePath = (name: string) => resolve(process.cwd(), 'public', 'samples', name);
const sample = (name: string) => readFileSync(samplePath(name), 'utf8');
const sampleBase64 = (name: string) => readFileSync(samplePath(name)).toString('base64');

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

const login = () =>
  call<{ user: { id: string } }>('POST', '/auth/login', {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });

const companyId = () => call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;

interface JobView {
  job: {
    id: string;
    mapping: Record<string, string>;
    status: string;
    idempotency_key: string;
    report: { counts: Record<string, number> } | null;
  };
  sheets: { name: string }[];
  preview: {
    mapping: Record<string, string>;
    summary: { create: number; skip: number; errors: number; warnings: number };
    blocksImport: boolean;
    totals: { debit: string; credit: string; difference: string } | null;
    findings: { code: string; severity: string; message: string; details?: any }[];
    rows: Record<string, any[]>;
  };
}

const upload = (company: string, body: Record<string, unknown>) =>
  call<JobView>('POST', `/companies/${company}/migration/jobs`, body);

const importJob = (company: string, jobId: string) =>
  call<{ counts: Record<string, number>; conflicts: unknown[] }>(
    'POST',
    `/companies/${company}/migration/jobs/${jobId}/import`,
    { confirm: true },
  );

const accounts = (company: string, includeInactive = false) =>
  call<{ accounts: { code: string; is_active: boolean }[] }>(
    'GET',
    `/companies/${company}/accounts${includeInactive ? '?includeInactive=true' : ''}`,
  ).accounts;

const entries = (company: string) =>
  call<{ entries: { id: string; reference: string | null; source: string }[] }>(
    'GET',
    `/companies/${company}/entries?limit=200`,
  ).entries;

describe('démonstration — assistant de migration', () => {
  beforeEach(() => {
    resetDemo();
    login();
  });

  it('propose les profils avec leur statut réel (pris en charge / expérimental)', () => {
    const company = companyId();
    const catalogue = call<{ profiles: any[]; kinds: Record<string, unknown>; limits: any }>(
      'GET',
      `/companies/${company}/migration/profiles`,
    );
    const excel = catalogue.profiles.find((p) => p.source === 'excel');
    const sap = catalogue.profiles.find((p) => p.source === 'sap');
    expect(excel.status).toBe('supported');
    expect(sap.status).toBe('experimental');
    expect(catalogue.kinds.chart_of_accounts).toBeTruthy();
    expect(catalogue.limits.maxRows).toBeGreaterThan(0);
  });

  it('importe le plan comptable CSV fictif après contrôles et confirmation', () => {
    const company = companyId();
    const before = accounts(company, true).length;
    const view = upload(company, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'plan-comptable-fictif.csv',
      contentText: sample('plan-comptable-fictif.csv'),
    });
    expect(view.preview.mapping.code).toBe('Code');
    expect(view.preview.mapping.name).toBe('Intitulé');
    expect(view.preview.summary.create).toBe(8);
    expect(view.preview.blocksImport).toBe(false);

    // La prévisualisation n'écrit rien.
    expect(accounts(company, true).length).toBe(before);

    const report = importJob(company, view.job.id);
    expect(report.counts.created).toBe(8);
    expect(accounts(company, true).length).toBe(before + 8);
    const codes = accounts(company, true).map((a) => a.code);
    expect(codes).toContain('8100');
    expect(codes).toContain('8999');
  });

  it('lit un classeur Excel multi-feuilles et importe la feuille choisie', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'excel',
      importKind: 'chart_of_accounts',
      fileName: 'plan-comptable-fictif.xlsx',
      contentBase64: sampleBase64('plan-comptable-fictif.xlsx'),
      sheetName: 'Plan comptable',
    });
    expect(view.sheets.map((s) => s.name)).toEqual(['Lisez-moi', 'Plan comptable']);
    expect(view.preview.summary.create).toBe(4);
    expect(view.preview.blocksImport).toBe(false);
    const report = importJob(company, view.job.id);
    expect(report.counts.created).toBe(4);
    expect(accounts(company, true).map((a) => a.code)).toContain('7101');
  });

  it('importe la balance d’ouverture équilibrée et bloque une seconde reprise', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'csv',
      importKind: 'opening_balance',
      fileName: 'balance-ouverture-fictive.csv',
      contentText: sample('balance-ouverture-fictive.csv'),
      options: { openingDate: '2025-07-01', defaultJournalCode: 'OD' },
    });
    expect(view.preview.totals).toEqual({
      debit: '370000.0000',
      credit: '370000.0000',
      difference: '0.0000',
    });
    expect(view.preview.blocksImport).toBe(false);
    const report = importJob(company, view.job.id);
    expect(report.counts.entries).toBe(1);
    expect(entries(company).some((e) => e.source === 'migration_opening')).toBe(true);

    const reimport = upload(company, {
      source: 'csv',
      importKind: 'opening_balance',
      fileName: 'balance-ouverture-fictive.csv',
      contentText: sample('balance-ouverture-fictive.csv'),
      options: { openingDate: '2025-07-01', defaultJournalCode: 'OD' },
    });
    expect(reimport.preview.findings.some((f) => f.code === 'OPENING_ALREADY_EXISTS')).toBe(true);
    expect(reimport.preview.blocksImport).toBe(true);
  });

  it('importe le journal fictif FR avec trois écritures équilibrées', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'journal-fictif.csv',
      contentText: sample('journal-fictif.csv'),
    });
    expect(view.preview.mapping.entryKey).toBe('Pièce');
    expect(view.preview.mapping.entryDate).toBe('Date');
    expect(view.preview.rows.entries).toHaveLength(3);
    expect(view.preview.blocksImport).toBe(false);
    expect(view.preview.findings.some((f) => f.code === 'EXCHANGE_RATE_REQUIRED')).toBe(false);

    const report = importJob(company, view.job.id);
    expect(report.counts.entries).toBe(3);
    const created = entries(company).filter((e) => e.source === 'migration');
    expect(created.length).toBe(3);
    const eur = created.find((e) => e.reference === 'MIG-003');
    expect(eur).toBeTruthy();
  });

  it('lit l’export Sage fictif et associe ses en-têtes', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'sage50',
      importKind: 'journal_entries',
      fileName: 'export-sage-fictif.csv',
      contentText: sample('export-sage-fictif.csv'),
    });
    expect(view.preview.mapping.accountCode).toBe('Compte');
    expect(view.preview.mapping.entryKey).toBe('N° pièce');
    expect(view.preview.rows.entries!).toHaveLength(2);
    expect(view.preview.blocksImport).toBe(false);
    const report = importJob(company, view.job.id);
    expect(report.counts.entries).toBe(2);
  });

  it('lit l’export SAP fictif (indicateur débit/crédit) sans connexion SAP', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'sap',
      importKind: 'journal_entries',
      fileName: 'export-sap-fictif.csv',
      contentText: sample('export-sap-fictif.csv'),
    });
    expect(view.preview.mapping.accountCode).toBe('G/L Account');
    expect(view.preview.mapping.entryKey).toBe('Document Number');
    expect(view.preview.mapping.dcIndicator).toBe('Debit/Credit Indicator');
    expect(view.preview.rows.entries!).toHaveLength(2);
    expect(view.preview.rows.entries![0]!.debitTotal).toBe('36000.0000');
    expect(view.preview.blocksImport).toBe(false);
    const report = importJob(company, view.job.id);
    expect(report.counts.entries).toBe(2);
  });

  it('bloque le fichier volontairement incorrect sans rien créer', () => {
    const company = companyId();
    const before = entries(company).length;
    const view = upload(company, {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'fichier-incorrect.csv',
      contentText: sample('fichier-incorrect.csv'),
    });
    const codes = view.preview.findings.map((f) => f.code);
    expect(codes).toContain('INVALID_DATE');
    expect(codes).toContain('UNBALANCED_ENTRY');
    expect(codes).toContain('ACCOUNT_NOT_FOUND');
    expect(view.preview.blocksImport).toBe(true);
    expect(() => importJob(company, view.job.id)).toThrow();
    expect(entries(company).length).toBe(before);
  });

  it('ignore un réimport du même fichier (idempotence) sans doublon', () => {
    const company = companyId();
    const body = {
      source: 'csv',
      importKind: 'journal_entries',
      fileName: 'journal-fictif.csv',
      contentText: sample('journal-fictif.csv'),
    };
    const first = upload(company, body);
    importJob(company, first.job.id);
    const count = entries(company).length;

    const second = upload(company, body);
    expect(second.job.idempotency_key).toBe(first.job.idempotency_key);
    expect(second.preview.rows.entries!.every((g) => g.action === 'skip')).toBe(true);
    const report = importJob(company, second.job.id);
    expect(report.counts.created).toBe(0);
    expect(entries(company).length).toBe(count);
  });

  it('enregistre et applique un modèle de correspondance', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'plan-comptable-fictif.csv',
      contentText: sample('plan-comptable-fictif.csv'),
    });
    const saved = call<{ template: { id: string; name: string } }>(
      'POST',
      `/companies/${company}/migration/templates`,
      {
        name: 'Modèle plan fictif',
        importKind: 'chart_of_accounts',
        source: 'csv',
        mapping: view.preview.mapping,
        accountMapping: {},
        options: {},
      },
    );
    expect(saved.template.name).toBe('Modèle plan fictif');
    const list = call<{ templates: { id: string; mapping: Record<string, string> }[] }>(
      'GET',
      `/companies/${company}/migration/templates`,
    );
    expect(list.templates).toHaveLength(1);
    expect(list.templates[0]!.mapping.code).toBe('Code');
  });

  it('refuse l’import sans confirmation explicite', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'plan-comptable-fictif.csv',
      contentText: sample('plan-comptable-fictif.csv'),
    });
    expect(() =>
      call('POST', `/companies/${company}/migration/jobs/${view.job.id}/import`, {}),
    ).toThrow(/Confirmation/i);
  });

  it('n’expose jamais les lots d’une autre société', () => {
    const company = companyId();
    const view = upload(company, {
      source: 'csv',
      importKind: 'chart_of_accounts',
      fileName: 'plan-comptable-fictif.csv',
      contentText: sample('plan-comptable-fictif.csv'),
    });
    call('POST', '/auth/logout');
    const other = call<{ user: { id: string } }>('POST', '/auth/register', {
      email: 'outsider-migration@example.test',
      password: 'StrongPassw0rd!',
      fullName: 'Outsider',
      locale: 'fr',
    });
    expect(other.user.id).toBeTruthy();
    const own = call<{ company: { id: string } }>('POST', '/companies', {
      name: 'Société isolée (fictive)',
      financialYearStart: '2025-07-01',
      financialYearEnd: '2026-06-30',
      functionalCurrency: 'MUR',
    }).company;
    const companies = call<{ companies: { id: string }[] }>('GET', '/companies').companies;
    expect(companies.some((c) => c.id === own.id)).toBe(true);
    expect(() =>
      call('GET', `/companies/${own.id}/migration/jobs/${view.job.id}`),
    ).toThrow();
  });
});
