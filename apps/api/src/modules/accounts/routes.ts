import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { ACCOUNT_TYPES, FS_MAPPINGS, SUPPORTED_CURRENCIES, type AccountRow } from '../../types.js';
import { badRequest, conflict, notFound, AppError, mapDatabaseError } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';

const accountBody = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  nameEn: z.string().trim().max(200).nullish(),
  nameFr: z.string().trim().max(200).nullish(),
  type: z.enum(ACCOUNT_TYPES),
  postingAllowed: z.boolean().optional(),
  accountRole: z.string().trim().max(60).nullish(),
  vatDefault: z.string().trim().max(30).nullish(),
  parentId: z.string().uuid().nullish(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  isActive: z.boolean().optional(),
  fsMapping: z.enum(FS_MAPPINGS).nullish(),
  description: z.string().max(500).nullish(),
});

export function accountRoutes(app: FastifyInstance, db: Db) {
  app.get('/companies/:companyId/accounts', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer');

    const q = req.query as { includeInactive?: string; search?: string; type?: string };
    const where = ['a.company_id = $1'];
    const params: unknown[] = [companyId];
    if (q.includeInactive !== 'true') where.push('a.is_active = true');
    if (q.type) {
      params.push(q.type);
      where.push(`a.type = $${params.length}`);
    }
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      where.push(`(lower(a.code) LIKE $${params.length} OR lower(a.name) LIKE $${params.length}
        OR lower(coalesce(a.name_en,'')) LIKE $${params.length} OR lower(coalesce(a.name_fr,'')) LIKE $${params.length})`);
    }

    const res = await db.query(
      `SELECT a.*, p.code AS parent_code
         FROM accounts a
         LEFT JOIN accounts p ON p.id = a.parent_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.code`,
      params,
    );
    return { accounts: res.rows };
  });

  app.post('/companies/:companyId/accounts', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(accountBody, req.body);

    const dup = await db.query(
      'SELECT 1 FROM accounts WHERE company_id = $1 AND lower(btrim(code)) = lower(btrim($2))',
      [companyId, body.code],
    );
    if (dup.rowCount > 0) throw conflict('ACCOUNT_CODE_TAKEN', 'Account code already exists');

    if (body.parentId) {
      const parent = await db.query<AccountRow>(
        'SELECT * FROM accounts WHERE id = $1 AND company_id = $2',
        [body.parentId, companyId],
      );
      if (!parent.rows[0]) throw badRequest('ACCOUNT_PARENT_INVALID', 'Invalid parent account');
    }

    try {
      const created = await db.query<AccountRow>(
        `INSERT INTO accounts
           (company_id, code, name, name_en, name_fr, type, parent_id, currency, is_active,
            posting_allowed, account_role, vat_default, fs_mapping, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          companyId,
          body.code.trim(),
          body.name.trim(),
          body.nameEn ?? null,
          body.nameFr ?? null,
          body.type,
          body.parentId ?? null,
          body.currency ?? ctx.company.functional_currency,
          body.isActive ?? true,
          body.postingAllowed ?? true,
          body.accountRole ?? null,
          body.vatDefault ?? null,
          body.fsMapping ?? null,
          body.description ?? null,
        ],
      );
      await writeAudit(db, {
        companyId,
        userId: user.id,
        action: 'account.create',
        entityType: 'account',
        entityId: created.rows[0]!.id,
        details: { code: body.code },
        ip: clientIp(req),
      });
      return reply.code(201).send({ account: created.rows[0] });
    } catch (err) {
      throw mapDatabaseError(err) ?? err;
    }
  });

  app.patch('/companies/:companyId/accounts/:accountId', async (req) => {
    const user = req.user!;
    const { companyId, accountId } = req.params as { companyId: string; accountId: string };
    await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(accountBody.partial(), req.body);

    const existing = await db.query<AccountRow>(
      'SELECT * FROM accounts WHERE id = $1 AND company_id = $2',
      [accountId, companyId],
    );
    const current = existing.rows[0];
    if (!current) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');

    if (body.code && body.code.trim().toLowerCase() !== current.code.toLowerCase()) {
      const dup = await db.query(
        'SELECT 1 FROM accounts WHERE company_id = $1 AND lower(btrim(code)) = lower(btrim($2)) AND id <> $3',
        [companyId, body.code.trim(), accountId],
      );
      if (dup.rowCount > 0) throw conflict('ACCOUNT_CODE_TAKEN', 'Account code already exists');
    }

    if (body.parentId) {
      if (body.parentId === accountId) {
        throw badRequest('ACCOUNT_PARENT_INVALID', 'An account cannot be its own parent');
      }
      const parent = await db.query<AccountRow>(
        'SELECT * FROM accounts WHERE id = $1 AND company_id = $2',
        [body.parentId, companyId],
      );
      if (!parent.rows[0]) throw badRequest('ACCOUNT_PARENT_INVALID', 'Invalid parent account');
      // Prevent cycles: walk up from the new parent.
      let cursor: string | null = parent.rows[0].parent_id;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        if (cursor === accountId) {
          throw badRequest('ACCOUNT_PARENT_INVALID', 'Circular parent relationship');
        }
        seen.add(cursor);
        const up = await db.query<{ parent_id: string | null }>(
          'SELECT parent_id FROM accounts WHERE id = $1',
          [cursor],
        );
        cursor = up.rows[0]?.parent_id ?? null;
      }
    }

    const updated = await db.query<AccountRow>(
      `UPDATE accounts SET
         code = COALESCE($2, code),
         name = COALESCE($3, name),
         type = COALESCE($4, type),
         parent_id = CASE WHEN $5::boolean THEN $6::uuid ELSE parent_id END,
         currency = COALESCE($7, currency),
         is_active = COALESCE($8, is_active),
         fs_mapping = CASE WHEN $9::boolean THEN $10::text ELSE fs_mapping END,
         description = CASE WHEN $11::boolean THEN $12::text ELSE description END,
         name_en = CASE WHEN $14::boolean THEN $15::text ELSE name_en END,
         name_fr = CASE WHEN $16::boolean THEN $17::text ELSE name_fr END,
         posting_allowed = COALESCE($18, posting_allowed),
         account_role = CASE WHEN $19::boolean THEN $20::text ELSE account_role END,
         vat_default = CASE WHEN $21::boolean THEN $22::text ELSE vat_default END,
         updated_at = now()
       WHERE id = $1 AND company_id = $13
   RETURNING *`,
      [
        accountId,
        body.code?.trim() ?? null,
        body.name?.trim() ?? null,
        body.type ?? null,
        body.parentId !== undefined,
        body.parentId ?? null,
        body.currency ?? null,
        body.isActive ?? null,
        body.fsMapping !== undefined,
        body.fsMapping ?? null,
        body.description !== undefined,
        body.description ?? null,
        companyId,
        body.nameEn !== undefined,
        body.nameEn ?? null,
        body.nameFr !== undefined,
        body.nameFr ?? null,
        body.postingAllowed ?? null,
        body.accountRole !== undefined,
        body.accountRole ?? null,
        body.vatDefault !== undefined,
        body.vatDefault ?? null,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'account.update',
      entityType: 'account',
      entityId: accountId,
      details: { fields: Object.keys(body) },
      ip: clientIp(req),
    });
    return { account: updated.rows[0] };
  });

  app.delete('/companies/:companyId/accounts/:accountId', async (req) => {
    const user = req.user!;
    const { companyId, accountId } = req.params as { companyId: string; accountId: string };
    await requireCompany(db, user.id, companyId, 'accountant');

    const used = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM journal_lines WHERE account_id = $1 AND company_id = $2',
      [accountId, companyId],
    );
    if (Number(used.rows[0]?.count ?? '0') > 0) {
      throw new AppError(
        'ACCOUNT_IN_USE',
        409,
        'Account is used by journal entries; deactivate it instead',
      );
    }
    try {
      const res = await db.query('DELETE FROM accounts WHERE id = $1 AND company_id = $2', [
        accountId,
        companyId,
      ]);
      if (res.rowCount === 0) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');
    } catch (err) {
      throw mapDatabaseError(err) ?? err;
    }
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'account.delete',
      entityType: 'account',
      entityId: accountId,
      ip: clientIp(req),
    });
    return { ok: true };
  });
}
