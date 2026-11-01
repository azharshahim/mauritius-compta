import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db/index.js';
import { APP_VERSION, type Config } from './config.js';
import { AppError, mapDatabaseError } from './lib/errors.js';
import { resolveLocale, t } from './i18n/index.js';
import { buildAuthGuards } from './modules/auth/routes.js';
import { companyRoutes } from './modules/companies/routes.js';
import { companySettingsRoutes } from './modules/companies/settings.js';
import { accountRoutes } from './modules/accounts/routes.js';
import { chartRoutes } from './modules/accounts/chart.js';
import { documentRoutes } from './modules/documents/routes.js';
import { journalRoutes } from './modules/journals/routes.js';
import { entryRoutes } from './modules/entries/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { attachmentRoutes } from './modules/attachments/routes.js';
import { cabinetRoutes } from './modules/cabinet/routes.js';
import { billingRoutes } from './modules/billing/routes.js';
import { purchaseRoutes } from './modules/purchases/routes.js';
import { payrollRoutes } from './modules/payroll/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { migrationRoutes } from './modules/migration/routes.js';
import { bankRoutes } from './modules/bank/routes.js';
import { letteringRoutes } from './modules/lettering/routes.js';
import { fxRoutes } from './modules/fx/routes.js';
import { equityRoutes } from './modules/equity/routes.js';
import { fixedAssetRoutes } from './modules/fixed-assets/routes.js';
import { financialYearRoutes } from './modules/financial-years/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { accrualRoutes } from './modules/accruals/routes.js';
import { provisionRoutes } from './modules/provisions/routes.js';
import { backupRoutes } from './backup/routes.js';
import type { UserRow } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

export interface BuildOptions {
  db: Db;
  config: Config;
  logger?: boolean;
  webDist?: string | null;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { db, config } = options;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.NODE_ENV === 'test' ? 'silent' : 'info',
            redact: ['req.headers.cookie', 'req.headers.authorization'],
          },
    bodyLimit: 1_000_000,
    trustProxy: true,
  });

  app.decorateRequest('user', null);
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });

  // -------------------------------------------------------------------------
  // Security headers + CSRF hardening for cookie based sessions
  // -------------------------------------------------------------------------
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );

    if (config.NODE_ENV === 'production' && !config.COOKIE_SECURE) {
      // Misconfiguration guard: cookies must be Secure in production.
      req.log.warn('COOKIE_SECURE should be true in production');
    }

    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers.host;
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = '';
        }
        const allowed = new Set<string>();
        if (host) allowed.add(host);
        if (config.APP_URL) {
          try {
            allowed.add(new URL(config.APP_URL).host);
          } catch {
            /* ignore invalid APP_URL */
          }
        }
        if (!allowed.has(originHost)) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: t(reqLocale(req, config), 'FORBIDDEN'),
            },
          });
        }
      }
      const secFetchSite = req.headers['sec-fetch-site'];
      if (secFetchSite === 'cross-site') {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: t(reqLocale(req, config), 'FORBIDDEN') },
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // Error handling (never leak stack traces or SQL)
  // -------------------------------------------------------------------------
  app.setErrorHandler((error, req, reply) => {
    const locale = reqLocale(req, config);
    if (error instanceof AppError) {
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message && error.message !== error.code ? error.message : t(locale, error.code),
          details: error.details ?? undefined,
        },
      });
    }
    const mapped = mapDatabaseError(error);
    if (mapped) {
      return reply.code(mapped.status).send({
        error: { code: mapped.code, message: mapped.message ?? t(locale, mapped.code) },
      });
    }
    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send({
        error: { code: 'ATTACHMENT_TOO_LARGE', message: t(locale, 'ATTACHMENT_TOO_LARGE') },
      });
    }
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: t(locale, 'VALIDATION_ERROR') },
      });
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: t(locale, 'INTERNAL_ERROR') },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: t(reqLocale(req, config), 'NOT_FOUND') },
      });
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  app.get('/api/health', async () => ({ status: 'ok', version: APP_VERSION }));

  // -------------------------------------------------------------------------
  // API routes
  // -------------------------------------------------------------------------
  await app.register(async (api) => {
    const guards = buildAuthGuards({ db, config });
    guards.routes(api);

    await api.register(async (secured) => {
      secured.addHook('preHandler', async (req) => {
        await guards.currentUser(req);
      });
      companyRoutes(secured, db);
      companySettingsRoutes(secured, db);
      accountRoutes(secured, db);
      chartRoutes(secured, db);
      documentRoutes(secured, db, config);
      journalRoutes(secured, db);
      entryRoutes(secured, db, config);
      settingsRoutes(secured, db);
      reportRoutes(secured, db);
      attachmentRoutes(secured, db, config);
      // Mauritius Business Suite modules: Cabinet first-class, Billing and
      // Payroll as prepared (501) foundations with their own permissions.
      cabinetRoutes(secured, db);
      billingRoutes(secured, db);
      // Purchases & suppliers (mission 11): subledger + human-posted proposals.
      purchaseRoutes(secured, db);
      payrollRoutes(secured, db);
      // Mauritius AI Engine: provider-agnostic orchestration, BYOK, budgets.
      aiRoutes(secured, db, config);
      // Cabinet → Import & migration assistant: preview first, human
      // confirmation, then a single transactional import through the posting
      // service.
      migrationRoutes(secured, db, config);
      // Bank statement import and reconciliation: proposals only, human
      // confirmation, never an automatic accounting entry.
      bankRoutes(secured, db, config);
      // Ledger lettering (mission 12): posted lines only, additive groups.
      letteringRoutes(secured, db);
      fxRoutes(secured, db);
      // Equity register, annual closing and result allocation (mission 19):
      // human approval before any irreversible posting.
      equityRoutes(secured, db);
      fixedAssetRoutes(secured, db);
      financialYearRoutes(secured, db);
      inventoryRoutes(secured, db);
      accrualRoutes(secured, db);
      provisionRoutes(secured, db);
      // Mission 34: encrypted backup/export. Restore stays CLI-only.
      backupRoutes(secured, db, config);
    });
  }, { prefix: '/api' });

  // -------------------------------------------------------------------------
  // Static web app (production build) with SPA fallback
  // -------------------------------------------------------------------------
  const webDist =
    options.webDist ??
    (existsSync(path.resolve(process.cwd(), 'apps/web/dist'))
      ? path.resolve(process.cwd(), 'apps/web/dist')
      : null);

  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, index: ['index.html'], wildcard: false });
    app.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export function reqLocale(req: FastifyRequest, config: Config): 'fr' | 'en' {
  // 1. explicit client header, 2. authenticated user preference,
  // 3. Accept-Language negotiation, 4. instance default.
  const explicit = (req.headers['x-locale'] as string | undefined) ?? null;
  if (explicit) return resolveLocale(explicit);
  if (req.user?.locale) return resolveLocale(req.user.locale);
  const accept = req.headers['accept-language'];
  if (typeof accept === 'string' && accept.length > 0) return resolveLocale(accept);
  return config.DEFAULT_LOCALE;
}
