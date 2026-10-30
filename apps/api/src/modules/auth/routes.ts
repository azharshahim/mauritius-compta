import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { AppError, badRequest, unauthorized } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { generateSessionToken, hashPassword, verifyPassword } from '../../lib/password.js';
import { writeAudit } from '../../lib/audit.js';
import type { PublicUser, UserRow } from '../../types.js';
import type { Locale } from '../../i18n/index.js';

export interface AuthDeps {
  db: Db;
  config: Config;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  locale: u.locale,
});

const passwordSchema = (min: number) =>
  z
    .string()
    .min(min, `Password must be at least ${min} characters`)
    .max(200)
    .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), {
      message: 'Password must contain letters and digits',
    });

/**
 * Hash used to keep the login timing identical when the e-mail is unknown.
 * Generated once per process from random bytes: it can never match a password.
 */
const DUMMY_HASH = await hashPassword(randomBytes(32).toString('hex'));

export function buildAuthGuards(deps: AuthDeps) {
  const { db, config } = deps;

  async function currentUser(req: FastifyRequest): Promise<UserRow> {
    const token = req.cookies?.[config.SESSION_COOKIE_NAME];
    if (!token) throw unauthorized();
    const result = await db.query<UserRow>(
      `SELECT u.* FROM sessions s
         JOIN app_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = true`,
      [sha256(token)],
    );
    const user = result.rows[0];
    if (!user) throw unauthorized();
    req.user = user;
    return user;
  }

  async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
    await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, sha256(token), expiresAt, clientIp(req), req.headers['user-agent'] ?? null],
    );
    reply.setCookie(config.SESSION_COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
      expires: expiresAt,
    });
  }

  async function tooManyFailures(email: string, ip: string | null): Promise<boolean> {
    const since = new Date(Date.now() - config.LOGIN_WINDOW_MINUTES * 60_000);
    const res = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM login_attempts
        WHERE lower(email) = lower($1) AND successful = false AND created_at > $2`,
      [email, since],
    );
    if (Number(res.rows[0]?.count ?? '0') >= config.LOGIN_MAX_ATTEMPTS) return true;

    // Additional throttle per source address: prevents password spraying across
    // many e-mail addresses from a single client.
    if (!ip) return false;
    const byIp = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM login_attempts
        WHERE ip = $1 AND successful = false AND created_at > $2`,
      [ip, since],
    );
    return Number(byIp.rows[0]?.count ?? '0') >= config.LOGIN_MAX_ATTEMPTS_PER_IP;
  }

  /** Housekeeping: expired sessions and old login attempts are pruned. */
  async function purgeStaleSecurityRows(userId?: string) {
    if (!config.SESSION_PURGE_ON_LOGIN) return;
    await db.query('DELETE FROM sessions WHERE expires_at <= now()');
    if (userId) {
      await db.query(
        `DELETE FROM sessions WHERE user_id = $1 AND id NOT IN (
           SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20)`,
        [userId],
      );
    }
    await db.query("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'");
  }

  async function recordAttempt(email: string, ip: string | null, successful: boolean) {
    await db.query(
      'INSERT INTO login_attempts (email, ip, successful) VALUES ($1, $2, $3)',
      [email, ip, successful],
    );
  }

  function routes(app: FastifyInstance) {
    app.post('/auth/register', async (req, reply) => {
      if (!config.ALLOW_REGISTRATION) {
        throw new AppError('REGISTRATION_DISABLED', 403, 'Account creation is disabled');
      }
      const body = parse(
        z.object({
          email: z.string().email().max(254),
          password: passwordSchema(config.PASSWORD_MIN_LENGTH),
          fullName: z.string().min(2).max(120),
          locale: z.enum(['fr', 'en']).optional(),
        }),
        req.body,
      );

      const exists = await db.query('SELECT 1 FROM app_users WHERE lower(email) = lower($1)', [
        body.email,
      ]);
      if (exists.rowCount > 0) throw new AppError('EMAIL_TAKEN', 409, 'Email already registered');

      const passwordHash = await hashPassword(body.password);
      const created = await db.query<UserRow>(
        `INSERT INTO app_users (email, password_hash, full_name, locale)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [body.email.trim(), passwordHash, body.fullName.trim(), body.locale ?? 'fr'],
      );
      const user = created.rows[0]!;
      await writeAudit(db, {
        userId: user.id,
        action: 'user.register',
        entityType: 'user',
        entityId: user.id,
        ip: clientIp(req),
      });
      await createSession(req, reply, user.id);
      return reply.code(201).send({ user: toPublicUser(user) });
    });

    app.post('/auth/login', async (req, reply) => {
      const body = parse(
        z.object({
          email: z.string().email(),
          password: z.string().min(1).max(200),
          locale: z.enum(['fr', 'en']).optional(),
        }),
        req.body,
      );
      const ip = clientIp(req);

      if (await tooManyFailures(body.email, ip)) {
        throw new AppError('LAST_LOGIN_TOO_MANY', 429, 'Too many failed attempts');
      }

      const found = await db.query<UserRow>(
        'SELECT * FROM app_users WHERE lower(email) = lower($1)',
        [body.email.trim()],
      );
      const user = found.rows[0];
      // Always run a hash comparison, even for an unknown address, so that the
      // response time does not reveal whether an account exists.
      const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);

      if (!user || !ok || !user.is_active) {
        await recordAttempt(body.email, ip, false);
        await writeAudit(db, {
          userId: user?.id ?? null,
          action: 'user.login_failed',
          entityType: 'user',
          entityId: user?.id ?? null,
          ip,
        });
        throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid credentials');
      }

      await recordAttempt(body.email, ip, true);
      if (body.locale && body.locale !== user.locale) {
        await db.query('UPDATE app_users SET locale = $2, updated_at = now() WHERE id = $1', [
          user.id,
          body.locale,
        ]);
        user.locale = body.locale;
      }
      await createSession(req, reply, user.id);
      await purgeStaleSecurityRows(user.id);
      await writeAudit(db, {
        userId: user.id,
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        ip,
      });
      return { user: toPublicUser(user) };
    });

    app.post('/auth/logout', async (req, reply) => {
      const token = req.cookies?.[config.SESSION_COOKIE_NAME];
      if (token) {
        await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
      }
      reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
      return { ok: true };
    });

    app.get('/auth/me', async (req) => {
      const user = await currentUser(req);
      return { user: toPublicUser(user) };
    });

    app.patch('/auth/me', async (req) => {
      const user = await currentUser(req);
      const body = parse(
        z.object({
          fullName: z.string().min(2).max(120).optional(),
          locale: z.enum(['fr', 'en']).optional(),
          currentPassword: z.string().optional(),
          newPassword: passwordSchema(config.PASSWORD_MIN_LENGTH).optional(),
        }),
        req.body,
      );

      let passwordHash: string | undefined;
      if (body.newPassword) {
        if (
          !body.currentPassword ||
          !(await verifyPassword(body.currentPassword, user.password_hash))
        ) {
          throw badRequest('VALIDATION_ERROR', 'Current password is incorrect', [
            { path: 'currentPassword', message: 'Current password is incorrect' },
          ]);
        }
        passwordHash = await hashPassword(body.newPassword);
        await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      }

      const updated = await db.query<UserRow>(
        `UPDATE app_users
            SET full_name = COALESCE($2, full_name),
                locale = COALESCE($3, locale),
                password_hash = COALESCE($4, password_hash),
                updated_at = now()
          WHERE id = $1
      RETURNING *`,
        [user.id, body.fullName ?? null, body.locale ?? null, passwordHash ?? null],
      );
      await writeAudit(db, {
        userId: user.id,
        action: 'user.update',
        entityType: 'user',
        entityId: user.id,
        details: { passwordChanged: Boolean(passwordHash) },
        ip: clientIp(req),
      });
      // A password change invalidates every session (including the current one):
      // the client must sign in again.
      return { user: toPublicUser(updated.rows[0]!), sessionsInvalidated: Boolean(passwordHash) };
    });

    app.get('/auth/sessions', async (req) => {
      const user = await currentUser(req);
      const res = await db.query(
        `SELECT id, created_at, expires_at, ip, user_agent
           FROM sessions WHERE user_id = $1 AND expires_at > now()
          ORDER BY created_at DESC`,
        [user.id],
      );
      return { sessions: res.rows };
    });
  }

  return { currentUser, routes };
}
