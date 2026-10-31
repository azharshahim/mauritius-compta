import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  getAccounts,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers.js';
import { decryptSecret, encryptSecret, buildKeyring } from '../src/modules/ai/crypto.js';
import { estimateCost, parsePriceToMicro } from '../src/modules/ai/cost.js';
import { chooseAccount, parseAccountBlock, ruleKeyword } from '../src/modules/ai/simulation.js';
import { suggestAccount } from '../src/modules/ai/suggestions.js';
import { AIService } from '../src/modules/ai/service.js';
import type { AICompletion, AICompletionRequest } from '../src/modules/ai/types.js';

/**
 * Mission 5 - Mauritius AI Engine.
 *
 * Every company, user, key and description used here is fictional. No test
 * performs a network call: the simulated provider is deterministic and the
 * global `fetch` is replaced by a spy that fails the test if it is ever used.
 */

const TEST_KEY = createHash('sha256').update('mission-5-test-encryption-key').digest('hex');
const OTHER_KEY = createHash('sha256').update('mission-5-other-key').digest('hex');

const cookieFor = async (ctx: TestContext, email: string): Promise<string> => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'StrongPassw0rd!' },
  });
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : (raw as string);
  return value!.split(';')[0]!;
};

async function enableSimulated(
  ctx: TestContext,
  cookie: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const res = await api(ctx, cookie, 'PATCH', '/api/cabinet/ai/settings', {
    enabled: true,
    primary: { provider: 'simulated', model: 'simulated-fictif' },
    features: { accounting: true, cabinet: false, billing: false, payroll: false },
    ...extra,
  });
  if (res.statusCode !== 200) throw new Error(`Enable AI failed: ${res.statusCode} ${res.body}`);
}

describe('Mauritius AI Engine - providers, keys, budgets', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  const fetchSpy = vi.fn();

  beforeAll(async () => {
    ctx = await createTestApp({ AI_ENCRYPTION_KEY: TEST_KEY });
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Dossier IA Fictif Ltée' });
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockImplementation(() => {
      throw new Error('No test is allowed to call an external AI provider');
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeTestApp(ctx);
  });

  it('exposes the cabinet settings with the provider catalogue and no key material', async () => {
    const res = await api(ctx, owner.cookie, 'GET', '/api/cabinet/ai/settings');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.encryptionReady).toBe(true);
    expect(body.sharedPoolEnabled).toBe(false);
    expect(body.enabled).toBe(false);
    const keys = body.providers.map((p: any) => p.key);
    expect(keys).toContain('openai');
    expect(keys).toContain('deepseek');
    expect(keys).toContain('gemini');
    expect(keys).toContain('mistral');
    expect(keys).toContain('openai_compatible');
    expect(keys).toContain('local');
    expect(keys).toContain('simulated');
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key"\s*:/i);
  });

  it('stores an API key encrypted, never returns it and revokes it', async () => {
    const secret = 'sk-test-fictif-0000000000000000';
    const put = await api(ctx, owner.cookie, 'PUT', '/api/cabinet/ai/credentials/openai', {
      apiKey: secret,
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain(secret);
    expect(put.json().configured).toBe(true);

    const stored = await ctx.db.query<{ ciphertext: string; key_version: string }>(
      `SELECT c.ciphertext, c.key_version FROM ai_credentials c
         JOIN companies co ON co.cabinet_id = c.cabinet_id
        WHERE co.id = $1 AND c.provider = 'openai'`,
      [company.id],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0]!.ciphertext).not.toContain(secret);
    expect(stored.rows[0]!.ciphertext.startsWith('sk-')).toBe(false);
    expect(stored.rows[0]!.key_version).toBe('v1');

    const view = await api(ctx, owner.cookie, 'GET', '/api/cabinet/ai/settings');
    expect(view.body).not.toContain(secret);
    const openai = view.json().providers.find((p: any) => p.key === 'openai');
    expect(openai.configured).toBe(true);

    const del = await api(ctx, owner.cookie, 'DELETE', '/api/cabinet/ai/credentials/openai');
    expect(del.statusCode).toBe(200);
    expect(del.json().configured).toBe(false);

    const after = await api(ctx, owner.cookie, 'GET', '/api/cabinet/ai/settings');
    expect(after.json().providers.find((p: any) => p.key === 'openai').configured).toBe(false);
  });

  it('rejects a base URL that points at a private host', async () => {
    const res = await api(ctx, owner.cookie, 'PUT', '/api/cabinet/ai/credentials/openai_compatible', {
      apiKey: 'sk-fictif-1234567890',
      baseUrl: 'http://127.0.0.1:8080/v1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AI_BASE_URL_INVALID');
  });

  it('refuses automatic routing without verified dated prices', async () => {
    await enableSimulated(ctx, owner.cookie, { routingMode: 'automatic' });
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/suggestions/account`, {
      description: 'Achat de fournitures de bureau',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AI_ROUTING_DISABLED');

    await enableSimulated(ctx, owner.cookie, { routingMode: 'manual' });
  });

  it('suggests an account from the real chart and never posts an entry', async () => {
    await enableSimulated(ctx, owner.cookie);
    const accounts = await getAccounts(ctx, owner.cookie, company.id);
    expect(accounts.length).toBeGreaterThan(0);

    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/suggestions/account`, {
      description: 'Achat de fournitures de bureau — 2 500 MUR',
      amount: '2500.00',
      currency: 'MUR',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.entryCreated).toBe(false);
    expect(body.suggestion.status).toBe('proposed');
    expect(body.suggestion.account).toBeTruthy();
    // The proposal must reference an account of *this* company.
    expect(accounts.some((a: any) => a.id === body.suggestion.account.id)).toBe(true);
    expect(body.suggestion.confidence).toBeGreaterThan(0);

    const entries = await ctx.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM journal_entries WHERE company_id = $1',
      [company.id],
    );
    expect(entries.rows[0]!.count).toBe('0');

    // Accepting does not post anything either.
    const decision = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/suggestions/${body.suggestion.id}/decision`,
      { decision: 'accepted', createRule: true, keyword: 'fournitures bureau' },
    );
    expect(decision.statusCode).toBe(200);
    expect(decision.json().entryCreated).toBe(false);
    expect(decision.json().ruleCreated).toEqual({
      keyword: 'fournitures bureau',
      accountId: body.suggestion.account.id,
    });

    const entriesAfter = await ctx.db.query<{ count: string }>(
      'SELECT count(*) AS count FROM journal_entries WHERE company_id = $1',
      [company.id],
    );
    expect(String(entriesAfter.rows[0]!.count)).toBe('0');

    // The learned rule is used next time, without calling any provider.
    const again = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/suggestions/account`, {
      description: 'Fournitures bureau pour le bureau de Quatre Bornes',
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().suggestion.source).toBe('rule');
    expect(again.json().suggestion.account.id).toBe(body.suggestion.account.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an account that is not in the company chart', async () => {
    const other = await createCompany(ctx, owner.cookie, { name: 'Autre Dossier Fictif Ltée' });
    const otherAccounts = await getAccounts(ctx, owner.cookie, other.id);

    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/suggestions/account`, {
      description: 'Abonnement logiciel de gestion',
    });
    expect(created.statusCode).toBe(201);

    const res = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/suggestions/${created.json().suggestion.id}/decision`,
      { decision: 'modified', accountId: otherAccounts[0]!.id },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AI_ACCOUNT_NOT_IN_CHART');
  });

  it('tracks usage without inventing a cost', async () => {
    const usage = await api(ctx, owner.cookie, 'GET', '/api/cabinet/ai/usage');
    expect(usage.statusCode).toBe(200);
    const body = usage.json();
    expect(body.requests).toBeGreaterThan(0);
    // No dated price is shipped: the cost must be reported as unavailable.
    expect(body.costKnown).toBe(false);
    expect(body.estimatedCostUsd).toBeNull();
    expect(body.byProvider.length).toBeGreaterThan(0);
    expect(body.budget.state).toBe('unknown');

    const rows = await ctx.db.query<{ cost_source: string; estimated_cost_usd: string | null }>(
      'SELECT cost_source, estimated_cost_usd FROM ai_usage LIMIT 5',
    );
    expect(rows.rows.every((r) => r.cost_source === 'unknown')).toBe(true);
    expect(rows.rows.every((r) => r.estimated_cost_usd === null)).toBe(true);
  });

  it('blocks once the monthly request cap is reached', async () => {
    await api(ctx, owner.cookie, 'PATCH', '/api/cabinet/ai/settings', { monthlyRequestLimit: 1 });
    const usage = await api(ctx, owner.cookie, 'GET', '/api/cabinet/ai/usage');
    if (usage.json().requests > 0) {
      const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/suggestions/account`, {
        description: 'Carburant véhicule de service',
      });
      expect(res.statusCode).toBe(402);
      expect(res.json().error.code).toBe('AI_BUDGET_EXCEEDED');
    }
    await api(ctx, owner.cookie, 'PATCH', '/api/cabinet/ai/settings', { monthlyRequestLimit: null });
  });

  it('honours the AI kill switch and the per-module feature switches', async () => {
    await api(ctx, owner.cookie, 'PATCH', '/api/cabinet/ai/settings', {
      features: { accounting: false, cabinet: false, billing: false, payroll: false },
    });
    const off = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/suggestions/account`, {
      description: 'Loyer du mois',
    });
    expect(off.statusCode).toBe(403);
    expect(off.json().error.code).toBe('AI_FEATURE_DISABLED');

    await enableSimulated(ctx, owner.cookie, { enabled: false });
    const disabled = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/suggestions/account`, {
      description: 'Loyer du mois',
    });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json().error.code).toBe('AI_DISABLED');
    await enableSimulated(ctx, owner.cookie);
  });

  it('reports announced features as not implemented', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/features/purchase_invoice_extraction`);
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('Mauritius AI Engine - cabinet and company isolation', () => {
  let ctx: TestContext;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let aliceCompany: any;

  beforeAll(async () => {
    ctx = await createTestApp({ AI_ENCRYPTION_KEY: TEST_KEY });
    alice = await registerUser(ctx, { email: 'alice.cabinet@example.test' });
    bob = await registerUser(ctx, { email: 'bob.cabinet@example.test' });
    carol = await registerUser(ctx, { email: 'carol.compta@example.test' });

    aliceCompany = await createCompany(ctx, alice.cookie, { name: 'Dossier Alice Fictif Ltée' });
    await createCompany(ctx, bob.cookie, { name: 'Dossier Bob Fictif Ltée' });

    // Carol is an accountant (read cabinet, write accounting) in Alice's dossier.
    const member = await api(ctx, alice.cookie, 'POST', `/api/companies/${aliceCompany.id}/members`, {
      email: carol.email,
      fullName: 'Carol Fictive',
      role: 'accountant',
      temporaryPassword: 'StrongPassw0rd!',
    });
    expect(member.statusCode).toBe(201);

    await enableSimulated(ctx, alice.cookie);
    await enableSimulated(ctx, bob.cookie);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('gives each cabinet its own settings', async () => {
    const aliceSettings = await api(ctx, alice.cookie, 'GET', '/api/cabinet/ai/settings');
    const bobSettings = await api(ctx, bob.cookie, 'GET', '/api/cabinet/ai/settings');
    expect(aliceSettings.json().cabinetId).not.toBe(bobSettings.json().cabinetId);

    // Bob cannot read Alice's cabinet, even with the identifier in the URL.
    const forbidden = await api(
      ctx,
      bob.cookie,
      'GET',
      `/api/cabinet/ai/settings?cabinetId=${aliceSettings.json().cabinetId}`,
    );
    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.json().error.code).toBe('CABINET_NOT_FOUND');
  });

  it('refuses keys for another cabinet and for non-administrators', async () => {
    const aliceSettings = await api(ctx, alice.cookie, 'GET', '/api/cabinet/ai/settings');

    const crossCabinet = await api(
      ctx,
      bob.cookie,
      'PUT',
      `/api/cabinet/ai/credentials/openai?cabinetId=${aliceSettings.json().cabinetId}`,
      { apiKey: 'sk-bob-fictif-000000' },
    );
    expect(crossCabinet.statusCode).toBe(404);

    const carolCookie = await cookieFor(ctx, carol.email);
    const notAdmin = await api(ctx, carolCookie, 'PATCH', '/api/cabinet/ai/settings', { enabled: true });
    expect(notAdmin.statusCode).toBe(403);
    expect(notAdmin.json().error.code).toBe('AI_FORBIDDEN');

    const carolKey = await api(ctx, carolCookie, 'PUT', '/api/cabinet/ai/credentials/openai', {
      apiKey: 'sk-carol-fictif-000000',
    });
    expect(carolKey.statusCode).toBe(403);
  });

  it('keeps company-scoped AI inside the company and its members', async () => {
    const outsider = await api(ctx, bob.cookie, 'POST', `/api/companies/${aliceCompany.id}/ai/suggestions/account`, {
      description: 'Achat de fournitures',
    });
    expect(outsider.statusCode).toBe(404);
    expect(outsider.json().error.code).toBe('COMPANY_NOT_FOUND');

    const carolCookie = await cookieFor(ctx, carol.email);
    const allowed = await api(ctx, carolCookie, 'POST', `/api/companies/${aliceCompany.id}/ai/suggestions/account`, {
      description: 'Achat de fournitures de bureau',
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().suggestion.company_id).toBe(aliceCompany.id);
  });

  it('records the cabinet on every usage row', async () => {
    const rows = await ctx.db.query<{ cabinet_id: string; company_id: string }>(
      'SELECT cabinet_id, company_id FROM ai_usage',
    );
    expect(rows.rowCount).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.cabinet_id).toBeTruthy();
    }
  });
});

describe('Mauritius AI Engine - key encryption', () => {
  const keyring = buildKeyring(TEST_KEY)!;
  const scope = { cabinetId: '11111111-1111-1111-1111-111111111111', provider: 'openai' };

  it('round-trips a secret and binds it to its cabinet and provider', () => {
    const secret = 'sk-fictif-roundtrip';
    const encrypted = encryptSecret(secret, keyring, scope);
    expect(encrypted.ciphertext).not.toContain(secret);
    expect(decryptSecret(encrypted, keyring, scope)).toBe(secret);
    expect(() =>
      decryptSecret(encrypted, keyring, { ...scope, cabinetId: '22222222-2222-2222-2222-222222222222' }),
    ).toThrow();
    expect(() => decryptSecret(encrypted, keyring, { ...scope, provider: 'gemini' })).toThrow();
  });

  it('rejects tampered payloads and unknown key versions', () => {
    const encrypted = encryptSecret('sk-fictif-tamper', keyring, scope);
    const parts = encrypted.ciphertext.split('.');
    const tampered = { ...encrypted, ciphertext: [parts[0], parts[1], 'AAAA'].join('.') };
    expect(() => decryptSecret(tampered, keyring, scope)).toThrow();

    const unknown = { ...encrypted, keyVersion: 'v9' };
    expect(() => decryptSecret(unknown, keyring, scope)).toThrow(/Unknown key version/);
  });

  it('supports rotation with a previous key', () => {
    const oldRing = buildKeyring(OTHER_KEY, 'v0')!;
    const encrypted = encryptSecret('sk-fictif-rotation', oldRing, scope);
    const rotated = buildKeyring(TEST_KEY, 'v1', `v0:${OTHER_KEY}`)!;
    expect(decryptSecret(encrypted, rotated, scope)).toBe('sk-fictif-rotation');
  });

  it('refuses to store a key when the encryption key is missing', async () => {
    const ctx = await createTestApp();
    try {
      const user = await registerUser(ctx);
      const company = await createCompany(ctx, user.cookie, { name: 'Sans Chiffrement Fictif Ltée' });
      void company;
      const res = await api(ctx, user.cookie, 'PUT', '/api/cabinet/ai/credentials/openai', {
        apiKey: 'sk-fictif-no-encryption',
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('AI_ENCRYPTION_NOT_CONFIGURED');
    } finally {
      await closeTestApp(ctx);
    }
  });
});

describe('Mauritius AI Engine - validation and costs', () => {
  it('never invents an account code', () => {
    const prompt = ['OPÉRATION: achat de fournitures', '[COMPTES AUTORISÉS]', '6100|Fournitures de bureau|expense', '[/COMPTES AUTORISÉS]'].join('\n');
    const accounts = parseAccountBlock(prompt);
    expect(accounts).toHaveLength(1);

    const match = chooseAccount('achat de fournitures de bureau', accounts);
    expect(match?.code).toBe('6100');

    const unmatched = chooseAccount('frais de douane', accounts);
    expect(['6100']).toContain(unmatched?.code);
  });

  it('extracts a reusable rule keyword', () => {
    expect(ruleKeyword('Achat de fournitures de bureau — 2 500 MUR')).toBe('achat fournitures bureau');
  });

  it('computes costs with exact integer arithmetic', () => {
    expect(parsePriceToMicro('0.150000')).toBe(150000n);
    const cost = estimateCost(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      { inputUsdPerMTok: '0.150000', outputUsdPerMTok: '0.600000' },
    );
    // 1M input × 0.15 + 0.5M output × 0.6 = 0.15 + 0.30 = 0.45
    expect(cost.decimal).toBe('0.450000');
    expect(cost.source).toBe('catalogue');

    const unknown = estimateCost({ inputTokens: 10, outputTokens: 10 }, null);
    expect(unknown.decimal).toBeNull();
    expect(unknown.missing).toContain('price');
  });

  it('rejects a provider answer that references an unknown account', async () => {
    const ctx = await createTestApp({ AI_ENCRYPTION_KEY: TEST_KEY });
    try {
      const user = await registerUser(ctx);
      const company = await createCompany(ctx, user.cookie, { name: 'Validation IA Fictive Ltée' });
      const cabinet = await ctx.db.query<{ cabinet_id: string }>(
        'SELECT cabinet_id FROM companies WHERE id = $1',
        [company.id],
      );
      const cabinetId = cabinet.rows[0]!.cabinet_id;

      await enableSimulated(ctx, user.cookie);
      const config = ctx.config;
      const catalogue = (await import('../src/modules/ai/catalogue.js')).loadCatalogue();
      const { ProviderRegistry } = await import('../src/modules/ai/registry.js');
      const service = new AIService(
        ctx.db,
        config,
        catalogue,
        new ProviderRegistry(catalogue, { simulatedEnabled: true }),
      );

      // A hostile/incorrect provider that answers with a non-existent code.
      const fake = {
        complete: async (_p: AICompletionRequest): Promise<AICompletion> => ({
          text: JSON.stringify({
            accountCode: '9999',
            category: 'supplies',
            rationale: 'compte inventé',
            confidence: 0.9,
          }),
          usage: { inputTokens: 10, outputTokens: 10 },
          model: 'fake',
        }),
      };
      const hostile = { complete: fake.complete } as unknown as AIService;
      void service;

      await expect(
        suggestAccount(ctx.db, hostile, {
          cabinetId,
          companyId: company.id,
          userId: user.id,
          description: 'Achat de fournitures',
          amount: null,
          currency: null,
        }),
      ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });

      const stored = await ctx.db.query('SELECT count(*) AS c FROM ai_suggestions WHERE company_id = $1', [
        company.id,
      ]);
      expect(String(stored.rows[0]!.c)).toBe('0');
    } finally {
      await closeTestApp(ctx);
    }
  });
});
