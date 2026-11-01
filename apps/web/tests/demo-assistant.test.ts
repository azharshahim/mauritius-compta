/**
 * Démonstration navigateur — mission 7.
 *
 * Assistant universel (conversation réellement interactive sur les données
 * fictives existantes), paramètres société et configuration TVA. Ces tests
 * exercent exactement le code publié sur GitHub Pages : aucun appel réseau.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

const login = () =>
  call<{ user: { id: string } }>('POST', '/auth/login', {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });

const companyId = () => call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;

interface Conversation {
  conversation: { id: string };
}

const openConversation = (company: string, module = 'billing') =>
  call<Conversation>('POST', `/companies/${company}/ai/assistant/conversations`, {
    companyId: company,
    module,
    screen: 'demo',
    locale: 'fr',
  });

const ask = (company: string, conversationId: string, text: string) =>
  call<{
    messages: { role: string; content: string; payload: { actions: any[] } }[];
    toolRuns: { tool: string; status: string }[];
  }>(
    'POST',
    `/companies/${company}/ai/assistant/conversations/${conversationId}/messages`,
    { companyId: company, text },
  );

describe('démonstration — assistant IA universel', () => {
  beforeEach(() => {
    resetDemo();
    login();
  });

  it('répond aux factures impayées avec les montants réels du dossier fictif', () => {
    const company = companyId();
    const { conversation } = openConversation(company);
    const res = ask(company, conversation.id, 'Quelles factures sont impayées ?');
    expect(res.toolRuns[0]).toMatchObject({ tool: 'billing.invoices.unpaid', status: 'ok' });
    const answer = res.messages[1]!.content;
    expect(answer).toContain('FAC-DEMO-0001');
    expect(answer).toContain('FAC-DEMO-0002');
    expect(answer).toMatch(/61\s?000/);
    expect(answer).toContain('FAC-DEMO-B');
    expect(answer).toMatch(/Aucune écriture comptable/);
  });

  it('explique la migration sans jamais confirmer un import', () => {
    const company = companyId();
    const { conversation } = openConversation(company, 'cabinet');
    const res = ask(company, conversation.id, 'Quels imports de migration sont en cours ?');
    expect(res.toolRuns[0]!.tool).toBe('migration.jobs.summary');
    const answer = res.messages[1]!.content;
    expect(answer).toMatch(/CSV, TSV et XLSX/);
    expect(answer).toMatch(/Sage 50\/200\/Accounting et SAP sont expérimentaux/);
    expect(answer).toMatch(/ne peut ni confirmer ni exécuter un import/);
    expect(res.messages[1]!.payload.actions[0]!.examineHref).toBe('/cabinet/migration');
  });

  it('liste les tâches en retard sans jamais les modifier', () => {
    const company = companyId();
    const before = call<{ tasks: any[] }>('GET', `/companies/${company}/tasks`).tasks.length;
    const { conversation } = openConversation(company, 'cabinet');
    const res = ask(company, conversation.id, 'Quelles tâches sont en retard ?');
    expect(res.toolRuns[0]!.tool).toBe('cabinet.tasks.overdue');
    const after = call<{ tasks: any[] }>('GET', `/companies/${company}/tasks`).tasks.length;
    expect(after).toBe(before);
    expect(res.messages[1]!.payload.actions[0]!.examineHref).toBe('/cabinet/tasks');
  });

  it('recherche un compte du plan comptable fictif', () => {
    const company = companyId();
    const { conversation } = openConversation(company, 'accounting');
    const res = ask(company, conversation.id, 'Recherche le compte 1200');
    expect(res.toolRuns[0]!.tool).toBe('accounting.accounts.search');
    expect(res.messages[1]!.content).toContain('TVA récupérable');
  });

  it('prépare l’exemple 3 250 / 487,50 / 3 737,50 sans comptabiliser', () => {
    const company = companyId();
    const before = call<{ total: number }>('GET', `/companies/${company}/entries?limit=1`).total;
    const { conversation } = openConversation(company, 'accounting');
    const res = ask(company, conversation.id, 'Prépare une écriture pour un achat de marchandises de 3250 MUR');
    const answer = res.messages[1]!.content;
    expect(res.toolRuns[0]!.tool).toBe('accounting.proposal.prepare');
    expect(answer).toContain('3250.0000');
    expect(answer).toContain('487.5000');
    expect(answer).toContain('3737.5000');
    expect(answer).toMatch(/Aucune écriture comptable n’a été créée/);
    const after = call<{ total: number }>('GET', `/companies/${company}/entries?limit=1`).total;
    expect(after).toBe(before);
    expect(res.messages[1]!.payload.actions[0]!.kind).toBe('proposal');
  });

  it('explique l’indisponibilité de la paie sans inventer de bulletin', () => {
    const company = companyId();
    const { conversation } = openConversation(company, 'payroll');
    const res = ask(company, conversation.id, 'Génère les bulletins de paie');
    expect(res.messages[1]!.content).toMatch(/non implémenté/);
    expect(res.messages[1]!.content).not.toMatch(/MUR \d/);
  });

  it('refuse clairement une demande non prise en charge', () => {
    const company = companyId();
    const { conversation } = openConversation(company);
    const res = ask(company, conversation.id, 'Envoie cette facture par e-mail au client');
    expect(res.messages[1]!.content).toMatch(/pas encore prise en charge/);
    expect(res.messages[1]!.payload.actions).toEqual([]);
  });

  it('expose un catalogue d’outils gouverné, sans exécution ni secret', () => {
    const company = companyId();
    const catalogue = call<{
      mode: string;
      governance: {
        executionEnabled: boolean;
        availableModes: string[];
        humanValidationRequired: boolean;
        companyScoped: boolean;
        auditTable: string;
        secretsInFrontend: boolean;
      };
      tools: {
        key: string;
        mode: string;
        risk: string;
        requiredAccess: string;
        humanValidation: boolean;
        audit: boolean;
        companyScoped: boolean;
      }[];
    }>('GET', `/companies/${company}/ai/assistant/tools`);
    expect(catalogue.mode).toBe('deterministic-supervised');
    expect(catalogue.governance).toMatchObject({
      executionEnabled: false,
      availableModes: ['read', 'prepare'],
      humanValidationRequired: true,
      companyScoped: true,
      auditTable: 'ai_tool_runs',
      secretsInFrontend: false,
    });
    expect(catalogue.tools.every((tool) => tool.audit && tool.companyScoped)).toBe(true);
    const prepare = catalogue.tools.find((tool) => tool.key === 'accounting.proposal.prepare');
    expect(prepare).toMatchObject({
      mode: 'prepare', risk: 'medium', requiredAccess: 'write', humanValidation: true,
    });
    expect(catalogue.tools.filter((tool) => tool.mode === 'execute')).toEqual([]);
  });

  it('ne contacte aucun fournisseur externe (aucun fetch)', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const company = companyId();
    const { conversation } = openConversation(company);
    ask(company, conversation.id, 'Montre la balance');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('démonstration — paramètres société et TVA', () => {
  beforeEach(() => {
    resetDemo();
    login();
  });

  it('expose un référentiel unique et des permissions de modification', () => {
    const company = companyId();
    const view = call<{
      identification: { name: string };
      accounting: { functionalCurrency: string; periods: any[] };
      billing: { invoicePrefix: string };
      tax: { rates: any[]; unverifiedCount: number };
      chartOfAccounts: any[];
      permissions: { canEditIdentification: boolean };
    }>('GET', `/companies/${company}/settings/company`);
    expect(view.identification.name).toContain('Lagon Bleu');
    expect(view.accounting.functionalCurrency).toBe('MUR');
    expect(view.billing.invoicePrefix).toBe('FAC');
    expect(view.chartOfAccounts.length).toBeGreaterThan(10);
    expect(view.permissions.canEditIdentification).toBe(true);
    expect(view.tax.rates.length).toBeGreaterThan(0);
    expect(view.tax.unverifiedCount).toBeGreaterThan(0);
  });

  it('enregistre une modification d’identification et la journalise', () => {
    const company = companyId();
    call('PATCH', `/companies/${company}/settings/identification`, {
      contactEmail: 'nouveau.contact@demo.test',
    });
    const view = call<{
      identification: { contactEmail: string };
      history: { action: string }[];
    }>('GET', `/companies/${company}/settings/company`);
    expect(view.identification.contactEmail).toBe('nouveau.contact@demo.test');
    expect(view.history.some((h) => h.action === 'settings.identification.update')).toBe(true);
  });

  it('saisit un taux de 15 % comme paramètre fictif, non vérifié', () => {
    const company = companyId();
    const created = call<{ rate: { id: string; verified: boolean; treatment: string } }>(
      'POST',
      `/companies/${company}/billing/tax-rates`,
      {
        code: 'TEST-DEMO-15',
        label: 'Taux fictif de démonstration',
        rate: '15',
        effectiveFrom: '2025-07-01',
        treatment: 'taxable',
        source: 'Paramètre de démonstration — aucune valeur légale',
      },
    );
    expect(created.rate.verified).toBe(false);
    expect(created.rate.treatment).toBe('taxable');
  });

  it('refuse un taux vérifié sans source et une qualification non taxable avec pourcentage', () => {
    const company = companyId();
    expect(() =>
      call('POST', `/companies/${company}/billing/tax-rates`, {
        code: 'TEST-NOSOURCE',
        label: 'Sans source',
        rate: '15',
        effectiveFrom: '2025-07-01',
        verified: true,
      }),
    ).toThrow(/source/i);
    expect(() =>
      call('POST', `/companies/${company}/billing/tax-rates`, {
        code: 'TEST-EXEMPT-BAD',
        label: 'Exonéré avec taux',
        rate: '15',
        effectiveFrom: '2025-07-01',
        treatment: 'exempt',
      }),
    ).toThrow();
  });

  it('vérifie un taux avec source + confirmation, puis conserve l’historique', () => {
    const company = companyId();
    const created = call<{ rate: { id: string } }>('POST', `/companies/${company}/billing/tax-rates`, {
      code: 'TEST-VERIFY',
      label: 'Taux à vérifier',
      rate: '15',
      effectiveFrom: '2025-07-01',
    });
    expect(() =>
      call('POST', `/companies/${company}/billing/tax-rates/${created.rate.id}/verify`, {
        source: 'Document fictif',
        confirm: false,
      }),
    ).toThrow();
    const verified = call<{ rate: { verified: boolean; verifiedBy: string | null } }>(
      'POST',
      `/companies/${company}/billing/tax-rates/${created.rate.id}/verify`,
      { source: 'Document fictif de démonstration', confirm: true },
    );
    expect(verified.rate.verified).toBe(true);
    expect(verified.rate.verifiedBy).toBeTruthy();

    const history = call<{ events: { action: string }[] }>(
      'GET',
      `/companies/${company}/billing/tax-rates/${created.rate.id}/history`,
    );
    const actions = history.events.map((e) => e.action);
    expect(actions).toContain('created');
    expect(actions).toContain('verified');
  });

  it('refuse une facture standard avec un taux non vérifié', () => {
    const company = companyId();
    const rate = call<{ rates: { id: string; verified: boolean }[] }>(
      'GET',
      `/companies/${company}/billing/tax-rates`,
    ).rates.find((r) => !r.verified)!;
    call('PATCH', `/companies/${company}/billing/settings`, { vatEnabled: true });
    const customer = call<{ customer: { id: string } }>(
      'POST',
      `/companies/${company}/billing/customers`,
      { name: 'Client TVA Démo Fictif' },
    ).customer;
    expect(() =>
      call('POST', `/companies/${company}/billing/documents`, {
        kind: 'invoice',
        customerId: customer.id,
        issueDate: new Date().toISOString().slice(0, 10),
        lines: [{ description: 'Ligne taxable fictive', quantity: '1', unitPrice: '100', vatRateId: rate.id }],
      }),
    ).toThrow(/vérifié/i);
  });
});
