import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, registerUser, type TestContext } from './helpers.js';

describe('authentication, authorisation and language', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('registers a user and returns a session cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'accountant@example.test',
        password: 'StrongPassw0rd!',
        fullName: 'Fictitious Accountant',
        locale: 'fr',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ user: { email: 'accountant@example.test', locale: 'fr' } });
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const weak = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'weak@example.test', password: 'short', fullName: 'Weak' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('VALIDATION_ERROR');

    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'accountant@example.test', password: 'StrongPassw0rd!', fullName: 'Dup' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid credentials without leaking account existence', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'accountant@example.test', password: 'WrongPassword1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in and out', async () => {
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'accountant@example.test', password: 'StrongPassw0rd!' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('accountant@example.test');

    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    const after = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('rejects unauthenticated access to protected endpoints', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/companies' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('localises API errors in French and English', async () => {
    const fr = await ctx.app.inject({
      method: 'GET',
      url: '/api/companies',
      headers: { 'x-locale': 'fr' },
    });
    expect(fr.json().error.message).toBe('Authentification requise.');

    const en = await ctx.app.inject({
      method: 'GET',
      url: '/api/companies',
      headers: { 'accept-language': 'en-GB,en;q=0.9' },
    });
    expect(en.json().error.message).toBe('Authentication required.');
  });

  it('switches the user locale (FR -> EN) and persists it', async () => {
    const user = await registerUser(ctx, { locale: 'fr' });
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie: user.cookie },
      payload: { locale: 'en' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().user.locale).toBe('en');

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: user.cookie },
    });
    expect(me.json().user.locale).toBe('en');
  });

  it('blocks cross-site state changing requests (CSRF hardening)', async () => {
    const user = await registerUser(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/companies',
      headers: { cookie: user.cookie, origin: 'https://evil.example' },
      payload: { name: 'Hijack Ltd' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('enforces role based authorisation server side', async () => {
    const owner = await registerUser(ctx);
    const company = await ctx.app.inject({
      method: 'POST',
      url: '/api/companies',
      headers: { cookie: owner.cookie },
      payload: {
        name: 'Role Test Ltd (fictitious)',
        financialYearStart: '2025-07-01',
        financialYearEnd: '2026-06-30',
      },
    });
    const companyId = company.json().company.id as string;

    const viewer = await registerUser(ctx);
    const add = await ctx.app.inject({
      method: 'POST',
      url: `/api/companies/${companyId}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: viewer.email, role: 'viewer' },
    });
    expect(add.statusCode).toBe(201);

    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/companies/${companyId}/accounts`,
      headers: { cookie: viewer.cookie },
    });
    expect(read.statusCode).toBe(200);

    const write = await ctx.app.inject({
      method: 'POST',
      url: `/api/companies/${companyId}/accounts`,
      headers: { cookie: viewer.cookie },
      payload: { code: '9999', name: 'Forbidden account', type: 'asset' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('FORBIDDEN');
  });
});
