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

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
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

describe('demo backend — cabinet module and module permissions', () => {
  beforeEach(() => {
    resetDemo();
    login();
  });

  const companyIdByName = (name: RegExp): string => {
    const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies')
      .companies;
    return companies.find((c) => name.test(c.name))!.id;
  };

  it('aggregates the cabinet dashboard from the fictional dossiers', () => {
    const dashboard = call<{
      metrics: { clients: number; archived: number; overdueTasks: number; openTasks: number };
      upcoming: unknown[];
      dossiers: unknown[];
    }>('GET', '/cabinet/dashboard');
    expect(dashboard.metrics.clients).toBe(4);
    expect(dashboard.metrics.archived).toBe(1);
    expect(dashboard.metrics.overdueTasks).toBeGreaterThanOrEqual(1);
    expect(dashboard.metrics.openTasks).toBeGreaterThan(0);
    expect(dashboard.dossiers).toHaveLength(4);
    expect(dashboard.upcoming.length).toBeGreaterThan(0);
  });

  it('creates, updates and comments a task', () => {
    const companyId = companyIdByName(/Lagon Bleu/);
    const created = call<{ task: { id: string; status: string } }>(
      'POST',
      `/companies/${companyId}/tasks`,
      { title: 'Tâche de test démo', category: 'vat', dueDate: '2026-12-01' },
    );
    expect(created.task.status).toBe('todo');

    const updated = call<{ task: { status: string; completed_at: string | null } }>(
      'PATCH',
      `/companies/${companyId}/tasks/${created.task.id}`,
      { status: 'done', comment: 'Terminé (fictif)' },
    );
    expect(updated.task.status).toBe('done');
    expect(updated.task.completed_at).toBeTruthy();

    const detail = call<{ comments: unknown[]; history: { action: string }[] }>(
      'GET',
      `/companies/${companyId}/tasks/${created.task.id}`,
    );
    expect(detail.comments).toHaveLength(1);
    expect(detail.history.map((h) => h.action)).toContain('cabinet.task.status');
  });

  it('rejects an assignee outside the dossier', () => {
    const companyId = companyIdByName(/Lagon Bleu/);
    expect(() =>
      call('POST', `/companies/${companyId}/tasks`, {
        title: 'Affectation interdite',
        category: 'accounting',
        assignedTo: crypto.randomUUID(),
      }),
    ).toThrowError(/appartient pas au dossier/);
  });

  it('archives a dossier read-only and restores it', () => {
    const companyId = companyIdByName(/Belle Mare/);
    const archived = call<{ company: { status: string; archived_at: string | null } }>(
      'POST',
      `/cabinet/companies/${companyId}/archive`,
    );
    expect(archived.company.status).toBe('archived');
    expect(archived.company.archived_at).toBeTruthy();

    const journal = journalId(companyId, 'OD');
    const account = accountId(companyId, '1010');
    expect(() =>
      call('POST', `/companies/${companyId}/entries`, {
        journalId: journal,
        entryDate: '2026-01-15',
        description: 'Écriture interdite',
        lines: [
          { accountId: account, debit: '10' },
          { accountId: accountId(companyId, '4000'), credit: '10' },
        ],
      }),
    ).toThrowError(/archivé/);

    const restored = call<{ company: { status: string } }>(
      'POST',
      `/cabinet/companies/${companyId}/unarchive`,
    );
    expect(restored.company.status).toBe('active');
  });

  it('separates payroll from accounting permissions', () => {
    const companyId = companyIdByName(/Lagon Bleu/);

    // The demonstration owner administers every module.
    const payroll = call<{ capabilities: { paye: boolean; csg: boolean } }>(
      'GET',
      `/companies/${companyId}/payroll/summary`,
    );
    expect(payroll.capabilities.paye).toBe(false);
    expect(payroll.capabilities.csg).toBe(false);

    // A dossier manager (fictional collaborator) has no payroll access at all.
    const managedCompany = companyIdByName(/Case Noyale/);
    call('POST', '/auth/logout');
    call('POST', '/auth/login', {
      email: 'a.ramgoolam@cabinet-demo.test',
      password: 'DemoCollab2026',
    });
    expect(() =>
      call('GET', `/companies/${managedCompany}/payroll/summary`),
    ).toThrowError(/pas accessible/);
    // …but can work on the accounting of that dossier.
    expect(
      call<{ accounts: unknown[] }>('GET', `/companies/${managedCompany}/accounts`).accounts.length,
    ).toBeGreaterThan(0);
  });

  it('announces billing as a prepared, unavailable module', () => {
    const companyId = companyIdByName(/Lagon Bleu/);
    const summary = call<{ available: boolean; capabilities: { vatComputation: boolean } }>(
      'GET',
      `/companies/${companyId}/billing/summary`,
    );
    expect(summary.available).toBe(false);
    expect(summary.capabilities.vatComputation).toBe(false);
    expect(() =>
      call('POST', `/companies/${companyId}/billing/documents`, { customerName: 'X' }),
    ).toThrowError(/non implémentée/);
  });

  it('lists collaborators with their dossier roles', () => {
    const team = call<{ collaborators: { email: string; assignments: unknown[] }[] }>(
      'GET',
      '/cabinet/team',
    );
    const emails = team.collaborators.map((c) => c.email);
    expect(emails).toContain(DEMO_EMAIL);
    expect(emails).toContain('a.ramgoolam@cabinet-demo.test');
    expect(team.collaborators.every((c) => c.assignments.length > 0)).toBe(true);
  });
});

describe('browser demo — Mauritius AI Engine (simulated, offline)', () => {
  it('exposes a fictional provider and no way to store a real key', () => {
    login();
    const settings = call<{
      enabled: boolean;
      sharedPoolEnabled: boolean;
      encryptionReady: boolean;
      simulatedAvailable: boolean;
      providers: { key: string; configured: boolean }[];
      usage: { costKnown: boolean };
    }>('GET', '/cabinet/ai/settings');

    expect(settings.enabled).toBe(true);
    expect(settings.simulatedAvailable).toBe(true);
    expect(settings.sharedPoolEnabled).toBe(false);
    expect(settings.encryptionReady).toBe(false);
    expect(settings.providers.map((p) => p.key)).toContain('simulated');
    expect(settings.providers.find((p) => p.key === 'simulated')!.configured).toBe(true);
    expect(settings.providers.find((p) => p.key === 'openai')!.configured).toBe(false);
    // No dated price is shipped: the cost is unknown, never invented.
    expect(settings.usage.costKnown).toBe(false);

    expect(() =>
      call('PUT', '/cabinet/ai/credentials/openai', { apiKey: 'sk-real-key-should-never-stick' }),
    ).toThrowError(/aucune clé API réelle/i);

    const stored = JSON.stringify(localStorage.getItem('mc.demo.state.v1'));
    expect(stored).not.toContain('sk-real-key-should-never-stick');
  });

  it('suggests an account from the company chart and never posts an entry', () => {
    login();
    const companyId = firstCompanyId();
    const before = call<{ entries: unknown[] }>('GET', `/companies/${companyId}/entries`).entries.length;

    const res = call<{ suggestion: any; entryCreated: boolean }>(
      'POST',
      `/companies/${companyId}/ai/suggestions/account`,
      { description: 'Achat de fournitures de bureau — 2 500 MUR', amount: '2500.00', currency: 'MUR' },
    );
    expect(res.entryCreated).toBe(false);
    expect(res.suggestion.status).toBe('proposed');
    expect(res.suggestion.source).toBe('provider');
    expect(res.suggestion.provider).toBe('simulated');
    expect(res.suggestion.account).toBeTruthy();

    const accounts = call<{ accounts: { id: string }[] }>('GET', `/companies/${companyId}/accounts`)
      .accounts;
    expect(accounts.some((a) => a.id === res.suggestion.account.id)).toBe(true);

    const decision = call<{ entryCreated: boolean; ruleCreated: any }>(
      'POST',
      `/companies/${companyId}/ai/suggestions/${res.suggestion.id}/decision`,
      { decision: 'accepted', createRule: true, keyword: 'fournitures bureau' },
    );
    expect(decision.entryCreated).toBe(false);
    expect(decision.ruleCreated).toBeTruthy();

    const after = call<{ entries: unknown[] }>('GET', `/companies/${companyId}/entries`).entries.length;
    expect(after).toBe(before);

    // The validated rule is reused without a provider call.
    const again = call<{ suggestion: any }>('POST', `/companies/${companyId}/ai/suggestions/account`, {
      description: 'Fournitures bureau — Curepipe',
    });
    expect(again.suggestion.source).toBe('rule');
    expect(again.suggestion.suggested_account_code).toBe(res.suggestion.suggested_account_code);
  });

  it('refuses an account that is not in the dossier chart', () => {
    login();
    const companyId = firstCompanyId();
    const otherId = call<{ companies: { id: string }[] }>('GET', '/companies').companies[1]!.id;
    const otherAccount = call<{ accounts: { id: string }[] }>(
      'GET',
      `/companies/${otherId}/accounts`,
    ).accounts[0]!.id;

    const created = call<{ suggestion: any }>('POST', `/companies/${companyId}/ai/suggestions/account`, {
      description: 'Abonnement logiciel',
    });
    expect(() =>
      call('POST', `/companies/${companyId}/ai/suggestions/${created.suggestion.id}/decision`, {
        decision: 'modified',
        accountId: otherAccount,
      }),
    ).toThrowError(/plan comptable/i);
  });

  it('honours the kill switch, the per-module switch and the request cap', () => {
    login();
    const companyId = firstCompanyId();

    call('PATCH', '/cabinet/ai/settings', { features: { accounting: false } });
    expect(() =>
      call('POST', `/companies/${companyId}/ai/suggestions/account`, { description: 'Loyer' }),
    ).toThrowError(/désactivées pour ce module/i);

    call('PATCH', '/cabinet/ai/settings', { features: { accounting: true }, enabled: false });
    expect(() =>
      call('POST', `/companies/${companyId}/ai/suggestions/account`, { description: 'Loyer' }),
    ).toThrowError(/désactivée/i);

    call('PATCH', '/cabinet/ai/settings', { enabled: true, monthlyRequestLimit: 1 });
    const used = call<{ requests: number }>('GET', '/cabinet/ai/usage').requests;
    if (used > 0) {
      expect(() =>
        call('POST', `/companies/${companyId}/ai/suggestions/account`, { description: 'Carburant' }),
      ).toThrowError(/plafond/i);
    }
    call('PATCH', '/cabinet/ai/settings', { monthlyRequestLimit: 50 });
  });

  it('keeps AI settings away from non-administrators', () => {
    call('POST', '/auth/login', {
      email: 'a.ramgoolam@cabinet-demo.test',
      password: 'DemoCollab2026',
    });
    expect(() => call('GET', '/cabinet/ai/settings')).toThrowError(/administration/i);
  });
});
