import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPgDb, createPgliteDb, migrate, type Db } from '../src/db/index.js';

/**
 * The suite runs on the embedded PGlite build by default. When
 * TEST_DATABASE_URL points at a real PostgreSQL server the very same tests run
 * against it (used by the `postgres-tests` CI job), which keeps the two
 * engines honest without duplicating the suite.
 */
export const usingRealPostgres = Boolean(process.env.TEST_DATABASE_URL);

async function truncateAll(db: Db): Promise<void> {
  const tables = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  const list = tables.rows.map((r) => `"${r.tablename}"`).join(', ');
  if (list) await db.exec(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  config: Config;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const db = process.env.TEST_DATABASE_URL
    ? await createPgDb(process.env.TEST_DATABASE_URL, { max: 8 })
    : await createPgliteDb();
  await migrate(db);
  await truncateAll(db);
  const config = loadConfig({
    NODE_ENV: 'test',
    SESSION_COOKIE_NAME: 'mc_session',
    PASSWORD_MIN_LENGTH: '10',
    ALLOW_REGISTRATION: 'true',
    COOKIE_SECURE: 'false',
    LOGIN_MAX_ATTEMPTS: '5',
    APP_URL: 'http://localhost:5173',
    STORAGE_DIR: './.test-storage',
    ...overrides,
  } as NodeJS.ProcessEnv);
  const app = await buildApp({ db, config, logger: false, webDist: null });
  await app.ready();
  return { app, db, config };
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.db.close();
}

export function cookieFrom(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (!value) throw new Error('No session cookie returned');
  return value.split(';')[0]!;
}

let counter = 0;

export interface TestUser {
  cookie: string;
  id: string;
  email: string;
}

export async function registerUser(
  ctx: TestContext,
  overrides: { email?: string; password?: string; locale?: 'fr' | 'en' } = {},
): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `user${counter}@example.test`;
  const password = overrides.password ?? 'StrongPassw0rd!';
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, fullName: 'Test User', locale: overrides.locale ?? 'fr' },
  });
  if (res.statusCode !== 201) {
    throw new Error(`Registration failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as { user: { id: string } };
  return { cookie: cookieFrom(res.headers as Record<string, unknown>), id: body.user.id, email };
}

export async function createCompany(
  ctx: TestContext,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/companies',
    headers: { cookie },
    payload: {
      name: 'Test Company Ltd (fictitious)',
      brn: `BRN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      vatNumber: 'VAT-TEST-0001',
      registeredAddress: '1, Test Street, Port Louis, Mauritius (fictitious)',
      businessActivity: 'Software services (fictitious)',
      financialYearStart: '2025-07-01',
      financialYearEnd: '2026-06-30',
      functionalCurrency: 'MUR',
      presentationCurrency: 'MUR',
      accountingStandard: 'IFRS',
      ...overrides,
    },
  });
  if (res.statusCode !== 201) throw new Error(`Company creation failed: ${res.body}`);
  return (res.json() as { company: any }).company;
}

export async function getAccounts(ctx: TestContext, cookie: string, companyId: string): Promise<any[]> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/companies/${companyId}/accounts`,
    headers: { cookie },
  });
  return (res.json() as { accounts: any[] }).accounts;
}

export async function getJournals(ctx: TestContext, cookie: string, companyId: string): Promise<any[]> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/companies/${companyId}/journals`,
    headers: { cookie },
  });
  return (res.json() as { journals: any[] }).journals;
}

export async function api(
  ctx: TestContext,
  cookie: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<any> {
  return ctx.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

export async function setupCompanyWithChart(): Promise<{
  ctx: TestContext;
  user: TestUser;
  company: any;
  accounts: any[];
  journals: any[];
}> {
  const ctx = await createTestApp();
  const user = await registerUser(ctx);
  const company = await createCompany(ctx, user.cookie);
  const accounts = await getAccounts(ctx, user.cookie, company.id);
  const journals = await getJournals(ctx, user.cookie, company.id);
  return { ctx, user, company, accounts, journals };
}

export const accountByCode = (accounts: any[], code: string) =>
  accounts.find((a) => a.code === code)!;
export const journalByCode = (journals: any[], code: string) =>
  journals.find((j) => j.code === code)!;
