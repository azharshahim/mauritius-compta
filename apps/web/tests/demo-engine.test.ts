/**
 * Browser demo backend — accounting behaviour.
 *
 * These tests exercise exactly what the GitHub Pages build runs in Chrome:
 * no server, no PostgreSQL, data in localStorage only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  currentUser,
  demoCsv,
  demoRequest,
  resetDemo,
} from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

const login = () =>
  call<{ user: { id: string } }>('POST', '/auth/login', {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });

function firstCompanyId(): string {
  return call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
}

function accountId(companyId: string, code: string): string {
  const accounts = call<{ accounts: { id: string; code: string }[] }>(
    'GET',
    `/companies/${companyId}/accounts`,
  ).accounts;
  const found = accounts.find((a) => a.code === code);
  if (!found) throw new Error(`account ${code} not found`);
  return found.id;
}

function journalId(companyId: string, code: string): string {
  const journals = call<{ journals: { id: string; code: string }[] }>(
    'GET',
    `/companies/${companyId}/journals`,
  ).journals;
  return journals.find((j) => j.code === code)!.id;
}

describe('demo backend — authentication', () => {
  beforeEach(() => resetDemo());

  it('signs in with the documented demo credentials only', () => {
    expect(() =>
      call('POST', '/auth/login', { email: DEMO_EMAIL, password: 'wrong-password' }),
    ).toThrowError(/Identifiants incorrects/);
    const res = login();
    expect(res.user.id).toBeTruthy();
    expect(currentUser()?.email).toBe(DEMO_EMAIL);
    expect(call<{ user: { email: string } }>('GET', '/auth/me').user.email).toBe(DEMO_EMAIL);
    call('POST', '/auth/logout');
    expect(currentUser()).toBeNull();
    expect(() => call('GET', '/auth/me')).toThrowError(/Authentification requise/);
  });

  it('never performs a network request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    login();
    call('GET', '/companies');
    call('GET', `/companies/${firstCompanyId()}/dashboard`);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('demo backend — accounting rules', () => {
  beforeEach(() => {
    resetDemo();
    login();
  });

  it('exposes a balanced demonstration dataset', () => {
    const companyId = firstCompanyId();
    const tb = call<{ balanced: boolean; rows: unknown[] }>(
      'GET',
      `/companies/${companyId}/reports/trial-balance`,
    );
    expect(tb.balanced).toBe(true);
    expect(tb.rows.length).toBeGreaterThan(5);

    const statements = call<{
      financialPosition: { balanced: boolean; totalAssets: string; totalLiabilitiesAndEquity: string };
    }>('GET', `/companies/${companyId}/reports/statements`);
    expect(statements.financialPosition.balanced).toBe(true);
    expect(statements.financialPosition.totalAssets).toBe(
      statements.financialPosition.totalLiabilitiesAndEquity,
    );
  });

  it('numbers entries, rejects imbalances and locks posted entries', () => {
    const companyId = firstCompanyId();
    const journal = journalId(companyId, 'OD');
    const cash = accountId(companyId, '1010');
    const revenue = accountId(companyId, '4000');

    const draft = call<{ entry: { id: string; entry_no: string; status: string } }>(
      'POST',
      `/companies/${companyId}/entries`,
      {
        journalId: journal,
        entryDate: '2026-03-01',
        description: 'Test démo',
        lines: [
          { accountId: cash, debit: '100.0000' },
          { accountId: revenue, credit: '100.0000' },
        ],
      },
    );
    expect(draft.entry.entry_no).toMatch(/^OD-2026-\d{4}$/);
    expect(draft.entry.status).toBe('draft');

    expect(() =>
      call('POST', `/companies/${companyId}/entries`, {
        journalId: journal,
        entryDate: '2026-03-02',
        description: 'Déséquilibrée',
        status: 'posted',
        lines: [
          { accountId: cash, debit: '100' },
          { accountId: revenue, credit: '90' },
        ],
      }),
    ).toThrowError(/Débit et crédit/);

    call('POST', `/companies/${companyId}/entries/${draft.entry.id}/post`);
    expect(() =>
      call('PATCH', `/companies/${companyId}/entries/${draft.entry.id}`, { description: 'X' }),
    ).toThrowError(/validée ne peut pas être modifiée/);
    expect(() => call('DELETE', `/companies/${companyId}/entries/${draft.entry.id}`)).toThrowError(
      /validée ne peut pas être supprimée/,
    );

    const reversal = call<{ entry: { entry_no: string; source: string } }>(
      'POST',
      `/companies/${companyId}/entries/${draft.entry.id}/reverse`,
      {},
    );
    expect(reversal.entry.source).toBe('reversal');
    expect(() =>
      call('POST', `/companies/${companyId}/entries/${draft.entry.id}/reverse`, {}),
    ).toThrowError(/déjà contrepassée/);

    const tb = call<{ balanced: boolean }>('GET', `/companies/${companyId}/reports/trial-balance`);
    expect(tb.balanced).toBe(true);
  });

  it('enforces unique references and the change-of-currency rule', () => {
    const companyId = firstCompanyId();
    const journal = journalId(companyId, 'OD');
    const cash = accountId(companyId, '1010');
    const revenue = accountId(companyId, '4000');
    const lines = [
      { accountId: cash, debit: '1000' },
      { accountId: revenue, credit: '1000' },
    ];

    call('POST', `/companies/${companyId}/entries`, {
      journalId: journal,
      entryDate: '2026-03-03',
      description: 'Référence unique',
      reference: 'REF-DEMO-1',
      lines,
    });
    expect(() =>
      call('POST', `/companies/${companyId}/entries`, {
        journalId: journal,
        entryDate: '2026-03-04',
        description: 'Doublon',
        reference: 'ref-demo-1',
        lines,
      }),
    ).toThrowError(/déjà utilisée/);

    const draft = call<{ entry: { id: string } }>(
      'POST',
      `/companies/${companyId}/entries`,
      { journalId: journal, entryDate: '2026-03-05', description: 'Devise', lines },
    );
    expect(() =>
      call('PATCH', `/companies/${companyId}/entries/${draft.entry.id}`, {
        currency: 'EUR',
        lines,
      }),
    ).toThrowError(/taux/i);

    const converted = call<{ entry: { exchange_rate: string }; lines: { debit: string }[] }>(
      'PATCH',
      `/companies/${companyId}/entries/${draft.entry.id}`,
      { currency: 'EUR', exchangeRate: '48.5000', lines },
    );
    expect(converted.entry.exchange_rate).toBe('48.50000000');
    expect(converted.lines[0]!.debit).toBe('48500.0000');
  });

  it('refuses to post into a closed period', () => {
    const companyId = firstCompanyId();
    const periods = call<{ periods: { id: string }[] }>('GET', `/companies/${companyId}`).periods;
    call('POST', `/companies/${companyId}/periods/${periods[0]!.id}/close`);
    expect(() =>
      call('POST', `/companies/${companyId}/entries`, {
        journalId: journalId(companyId, 'OD'),
        entryDate: '2026-04-01',
        description: 'Période fermée',
        status: 'posted',
        lines: [
          { accountId: accountId(companyId, '1010'), debit: '10' },
          { accountId: accountId(companyId, '4000'), credit: '10' },
        ],
      }),
    ).toThrowError(/Aucune période ouverte/);
  });

  it('keeps companies isolated', () => {
    const first = firstCompanyId();
    const second = call<{ company: { id: string } }>('POST', '/companies', {
      name: 'Deuxième société (fictive)',
      financialYearStart: '2025-07-01',
      financialYearEnd: '2026-06-30',
    }).company.id;
    expect(second).not.toBe(first);

    const entries = call<{ entries: unknown[] }>('GET', `/companies/${second}/entries`);
    expect(entries.entries).toHaveLength(0);

    const firstEntries = call<{ entries: { id: string }[] }>('GET', `/companies/${first}/entries`);
    expect(() =>
      call('GET', `/companies/${second}/entries/${firstEntries.entries[0]!.id}`),
    ).toThrowError(/introuvable/);
  });

  it('exports CSV without formulas and with the demonstration notice', () => {
    const companyId = firstCompanyId();
    call('POST', `/companies/${companyId}/entries`, {
      journalId: journalId(companyId, 'OD'),
      entryDate: '2026-03-06',
      description: '=HYPERLINK("http://example.invalid","clic")',
      status: 'posted',
      lines: [
        { accountId: accountId(companyId, '1010'), debit: '1' },
        { accountId: accountId(companyId, '4000'), credit: '1' },
      ],
    });
    const { text } = demoCsv(`/companies/${companyId}/reports/ledger`, 'csv');
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).toMatch(/DÉMONSTRATION|DEMONSTRATION/);
    expect(demoCsv(`/companies/${companyId}/reports/ledger`, 'pdf').mode).toBe('print');
  });

  it('reports dashboard KPIs consistent with the trial balance', () => {
    const companyId = firstCompanyId();
    const dashboard = call<{ kpis: { balancedSheet: boolean; totalAssets: string } }>(
      'GET',
      `/companies/${companyId}/dashboard`,
    );
    const statements = call<{ financialPosition: { totalAssets: string } }>(
      'GET',
      `/companies/${companyId}/reports/statements`,
    );
    expect(dashboard.kpis.balancedSheet).toBe(true);
    expect(dashboard.kpis.totalAssets).toBe(statements.financialPosition.totalAssets);
  });

  it('records simulated actions in a local audit trail', () => {
    const companyId = firstCompanyId();
    call('POST', `/companies/${companyId}/entries`, {
      journalId: journalId(companyId, 'OD'),
      entryDate: '2026-03-07',
      description: 'Audit local',
      lines: [
        { accountId: accountId(companyId, '1010'), debit: '5' },
        { accountId: accountId(companyId, '4000'), credit: '5' },
      ],
    });
    const audit = call<{ events: { action: string }[] }>(
      'GET',
      `/companies/${companyId}/audit?limit=50`,
    );
    expect(audit.events.map((e) => e.action)).toContain('entry.create_draft');
  });
});
