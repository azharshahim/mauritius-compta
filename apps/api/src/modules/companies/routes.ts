import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import { effectiveModules, requireModuleAccess } from '../../lib/permissions.js';
import { provisionCompanyDefaults } from '../../lib/provisioning.js';
import { hashPassword } from '../../lib/password.js';
import { loadCompanyRules, validateField } from './validation-rules.js';
import { COMPANY_ROLES, type CompanyRole, type CompanyRow, type UserRow } from '../../types.js';
import type { Locale } from '../../i18n/index.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const companyBody = z.object({
  name: z.string().min(1).max(200),
  brn: z.string().max(40).nullish(),
  crn: z.string().max(40).nullish(),
  clientCode: z.string().max(24).nullish(),
  dossierManagerId: z.string().uuid().nullish(),
  vatNumber: z.string().max(40).nullish(),
  registeredAddress: z.string().max(500).nullish(),
  businessActivity: z.string().max(300).nullish(),
  financialYearStart: isoDate,
  financialYearEnd: isoDate,
  functionalCurrency: z.string().length(3).optional(),
  presentationCurrency: z.string().length(3).optional(),
  accountingStandard: z.string().max(40).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  locale: z.enum(['fr', 'en']).optional(),
  withDefaultChart: z.boolean().optional(),
});

type CompanyBody = z.infer<typeof companyBody>;

function applyRules(body: CompanyBody, currencyList: string[], standardList: string[]) {
  const rules = loadCompanyRules();
  const issues = [
    validateField(rules.name, body.name, 'name'),
    validateField(rules.brn, body.brn, 'brn'),
    validateField(rules.vatNumber, body.vatNumber, 'vatNumber'),
    validateField(rules.brn, body.crn, 'crn'),
    validateField(rules.registeredAddress, body.registeredAddress, 'registeredAddress'),
    validateField(rules.businessActivity, body.businessActivity, 'businessActivity'),
  ].filter(Boolean) as { path: string; message: string }[];

  if (body.financialYearEnd <= body.financialYearStart) {
    issues.push({ path: 'financialYearEnd', message: 'Financial year end must be after start' });
  }
  const fc = body.functionalCurrency ?? 'MUR';
  const pc = body.presentationCurrency ?? fc;
  if (!currencyList.includes(fc)) {
    issues.push({ path: 'functionalCurrency', message: `Unsupported currency: ${fc}` });
  }
  if (!currencyList.includes(pc)) {
    issues.push({ path: 'presentationCurrency', message: `Unsupported currency: ${pc}` });
  }
  if (body.accountingStandard && !standardList.includes(body.accountingStandard)) {
    issues.push({
      path: 'accountingStandard',
      message: `Unsupported accounting standard: ${body.accountingStandard}`,
    });
  }
  if (issues.length > 0) {
    throw badRequest('VALIDATION_ERROR', issues[0]!.message, issues);
  }
}

export function companyRoutes(app: FastifyInstance, db: Db) {
  // -------------------------------------------------------------------------
  // List companies the current user is a member of
  // -------------------------------------------------------------------------
  app.get('/companies', async (req) => {
    const user = req.user!;
    const res = await db.query<CompanyRow & { role: CompanyRole }>(
      `SELECT c.*, m.role,
              (SELECT count(*)::int FROM accounts a WHERE a.company_id = c.id) AS accounts_count,
              (SELECT count(*)::int FROM cabinet_tasks t
                WHERE t.company_id = c.id AND t.status IN ('todo', 'in_progress', 'blocked')) AS open_tasks
         FROM companies c
         JOIN company_members m ON m.company_id = c.id
        WHERE m.user_id = $1
        ORDER BY c.created_at ASC`,
      [user.id],
    );
    // Module permissions travel with the company so the UI can hide spaces the
    // user cannot open (the API enforces them again on every request).
    const companies = await Promise.all(
      res.rows.map(async (row) => ({
        ...row,
        modules: await effectiveModules(db, row.id, user.id, row.role),
      })),
    );
    return { companies };
  });

  // -------------------------------------------------------------------------
  // Create company
  // -------------------------------------------------------------------------
  app.post('/companies', async (req, reply) => {
    const user = req.user!;
    const body = parse(companyBody, req.body);
    const rules = loadCompanyRules();
    applyRules(body, rules.currencies, rules.accountingStandards);

    const duplicate = await db.query(
      `SELECT 1 FROM companies WHERE $1::text IS NOT NULL AND lower(brn) = lower($1::text)`,
      [body.brn?.trim() || null],
    );
    if (duplicate.rowCount > 0) {
      throw conflict('CONFLICT', 'A company with this BRN already exists');
    }

    const locale: Locale = body.locale ?? user.locale ?? 'fr';
    const company = await db.transaction(async (tx) => {
      const created = await tx.query<CompanyRow>(
        `INSERT INTO companies
           (name, brn, vat_number, registered_address, business_activity,
            financial_year_start, financial_year_end, functional_currency,
            presentation_currency, accounting_standard, status, locale, created_by,
            crn, client_code, dossier_manager_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          body.name.trim(),
          body.brn?.trim() || null,
          body.vatNumber?.trim() || null,
          body.registeredAddress?.trim() || null,
          body.businessActivity?.trim() || null,
          body.financialYearStart,
          body.financialYearEnd,
          body.functionalCurrency ?? 'MUR',
          body.presentationCurrency ?? body.functionalCurrency ?? 'MUR',
          body.accountingStandard ?? 'IFRS',
          body.status ?? 'active',
          locale,
          user.id,
          body.crn?.trim() || null,
          body.clientCode?.trim() || null,
          body.dossierManagerId ?? null,
        ],
      );
      const row = created.rows[0]!;
      await tx.query(
        'INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)',
        [row.id, user.id, 'owner'],
      );
      // The first accounting period is always opened (independently of the
      // optional demonstration chart), otherwise no entry could ever be posted.
      await provisionCompanyDefaults(tx, row, locale, {
        withChart: body.withDefaultChart !== false,
      });
      await writeAudit(tx, {
        companyId: row.id,
        userId: user.id,
        action: 'company.create',
        entityType: 'company',
        entityId: row.id,
        details: { name: row.name },
        ip: clientIp(req),
      });
      return row;
    });

    return reply.code(201).send({ company });
  });

  // -------------------------------------------------------------------------
  // Read / update a company
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'viewer');
    const periods = await db.query(
      `SELECT id, name, start_date, end_date, status, closed_at
         FROM accounting_periods WHERE company_id = $1 ORDER BY start_date DESC`,
      [companyId],
    );
    return { company: ctx.company, role: ctx.role, periods: periods.rows };
  });

  app.patch('/companies/:companyId', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'admin');
    const patch = parse(companyBody.partial(), req.body);
    const rules = loadCompanyRules();

    const merged = {
      name: patch.name ?? ctx.company.name,
      brn: patch.brn !== undefined ? patch.brn : ctx.company.brn,
      vatNumber: patch.vatNumber !== undefined ? patch.vatNumber : ctx.company.vat_number,
      registeredAddress:
        patch.registeredAddress !== undefined ? patch.registeredAddress : ctx.company.registered_address,
      businessActivity:
        patch.businessActivity !== undefined ? patch.businessActivity : ctx.company.business_activity,
      financialYearStart: patch.financialYearStart ?? ctx.company.financial_year_start,
      financialYearEnd: patch.financialYearEnd ?? ctx.company.financial_year_end,
      functionalCurrency: patch.functionalCurrency ?? ctx.company.functional_currency,
      presentationCurrency: patch.presentationCurrency ?? ctx.company.presentation_currency,
      accountingStandard: patch.accountingStandard ?? ctx.company.accounting_standard,
      status: patch.status ?? ctx.company.status,
      locale: patch.locale ?? ctx.company.locale,
      crn: patch.crn !== undefined ? patch.crn : ctx.company.crn,
      clientCode: patch.clientCode !== undefined ? patch.clientCode : ctx.company.client_code,
      dossierManagerId:
        patch.dossierManagerId !== undefined
          ? patch.dossierManagerId
          : ctx.company.dossier_manager_id,
    };
    applyRules(merged as CompanyBody, rules.currencies, rules.accountingStandards);

    if (merged.brn) {
      const dup = await db.query(
        'SELECT 1 FROM companies WHERE lower(brn) = lower($1) AND id <> $2',
        [merged.brn.trim(), companyId],
      );
      if (dup.rowCount > 0) throw conflict('CONFLICT', 'A company with this BRN already exists');
    }

    const updated = await db.query<CompanyRow>(
      `UPDATE companies SET
         name = $2, brn = $3, vat_number = $4, registered_address = $5,
         business_activity = $6, financial_year_start = $7, financial_year_end = $8,
         functional_currency = $9, presentation_currency = $10, accounting_standard = $11,
         status = $12, locale = $13, crn = $14, client_code = $15, dossier_manager_id = $16,
         archived_at = CASE WHEN $12 = 'archived' AND archived_at IS NULL THEN now()
                            WHEN $12 <> 'archived' THEN NULL
                            ELSE archived_at END,
         updated_at = now()
       WHERE id = $1
   RETURNING *`,
      [
        companyId,
        merged.name.trim(),
        merged.brn?.trim() || null,
        merged.vatNumber?.trim() || null,
        merged.registeredAddress?.trim() || null,
        merged.businessActivity?.trim() || null,
        merged.financialYearStart,
        merged.financialYearEnd,
        merged.functionalCurrency,
        merged.presentationCurrency,
        merged.accountingStandard,
        merged.status,
        merged.locale,
        merged.crn?.trim() || null,
        merged.clientCode?.trim() || null,
        merged.dossierManagerId ?? null,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'company.update',
      entityType: 'company',
      entityId: companyId,
      details: { fields: Object.keys(patch) },
      ip: clientIp(req),
    });
    return { company: updated.rows[0] };
  });

  // -------------------------------------------------------------------------
  // Members / access management
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/members', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const res = await db.query(
      `SELECT u.id, u.email, u.full_name, m.role, m.created_at
         FROM company_members m JOIN app_users u ON u.id = m.user_id
        WHERE m.company_id = $1 ORDER BY m.created_at`,
      [companyId],
    );
    return { members: res.rows };
  });

  app.post('/companies/:companyId/members', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const body = parse(
      z.object({
        email: z.string().email(),
        role: z.enum(COMPANY_ROLES as [CompanyRole, ...CompanyRole[]]).refine(
          (r) => r !== 'owner',
          'Use the ownership transfer endpoint for the owner role',
        ),
        fullName: z.string().min(2).max(120).optional(),
        temporaryPassword: z.string().min(10).max(200).optional(),
      }),
      req.body,
    );

    const existing = await db.query<UserRow>('SELECT * FROM app_users WHERE lower(email) = lower($1)', [
      body.email,
    ]);
    let target = existing.rows[0];
    if (!target) {
      if (!body.temporaryPassword) {
        throw badRequest('VALIDATION_ERROR', 'A temporary password is required for a new user', [
          { path: 'temporaryPassword', message: 'Required for a new user' },
        ]);
      }
      const created = await db.query<UserRow>(
        `INSERT INTO app_users (email, password_hash, full_name)
         VALUES ($1, $2, $3) RETURNING *`,
        [body.email.trim(), await hashPassword(body.temporaryPassword), body.fullName ?? body.email],
      );
      target = created.rows[0]!;
    }

    const already = await db.query(
      'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
      [companyId, target.id],
    );
    if (already.rowCount > 0) throw conflict('CONFLICT', 'This user is already a member');
    await db.query(
      'INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)',
      [companyId, target.id, body.role],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'company.member.add',
      entityType: 'user',
      entityId: target.id,
      details: { role: body.role },
      ip: clientIp(req),
    });
    return reply.code(201).send({ member: { userId: target.id, email: target.email, role: body.role } });
  });

  app.delete('/companies/:companyId/members/:userId', async (req) => {
    const user = req.user!;
    const { companyId, userId } = req.params as { companyId: string; userId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    if (userId === user.id) {
      throw badRequest('VALIDATION_ERROR', 'You cannot remove yourself from the company');
    }
    const owners = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM company_members
        WHERE company_id = $1 AND role = 'owner'`,
      [companyId],
    );
    const targetRow = await db.query<{ role: CompanyRole }>(
      'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
      [companyId, userId],
    );
    if (!targetRow.rows[0]) throw notFound('NOT_FOUND', 'Member not found');
    if (targetRow.rows[0].role === 'owner' && Number(owners.rows[0]?.count ?? 0) <= 1) {
      throw badRequest('VALIDATION_ERROR', 'The last owner cannot be removed');
    }
    await db.query('DELETE FROM company_members WHERE company_id = $1 AND user_id = $2', [
      companyId,
      userId,
    ]);
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'company.member.remove',
      entityType: 'user',
      entityId: userId,
      ip: clientIp(req),
    });
    return { ok: true };
  });
}
