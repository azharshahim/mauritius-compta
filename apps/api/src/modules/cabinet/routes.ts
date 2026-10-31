import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import {
  ACCESS_WEIGHT,
  effectiveAccess,
  effectiveModules,
  requireModuleAccess,
} from '../../lib/permissions.js';
import {
  COMPANY_ROLES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type AccessLevel,
  type CompanyRole,
  type CompanyRow,
} from '../../types.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const taskBody = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(4000).nullish(),
  category: z.enum(TASK_CATEGORIES),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: isoDate.nullish(),
  assignedTo: z.string().uuid().nullish(),
});

const taskPatch = taskBody.partial().extend({
  comment: z.string().max(4000).optional(),
});

type CompanyWithRole = CompanyRow & { role: CompanyRole };

/**
 * Companies the user may see through the cabinet module, with the effective
 * cabinet access. A membership without any cabinet access (an accounting-only
 * collaborator restricted on purpose) is excluded.
 */
async function cabinetCompanies(
  db: Db,
  userId: string,
): Promise<{ companies: CompanyWithRole[]; access: Map<string, AccessLevel> }> {
  const res = await db.query<CompanyWithRole>(
    `SELECT c.*, m.role
       FROM companies c
       JOIN company_members m ON m.company_id = c.id
      WHERE m.user_id = $1
      ORDER BY c.name ASC`,
    [userId],
  );
  const access = new Map<string, AccessLevel>();
  const companies: CompanyWithRole[] = [];
  for (const row of res.rows) {
    const level = await effectiveAccess(db, row.id, userId, row.role, 'cabinet');
    if (ACCESS_WEIGHT[level] > 0) {
      access.set(row.id, level);
      companies.push(row);
    }
  }
  return { companies, access };
}

function placeholders(count: number, offset = 1): string {
  return Array.from({ length: count }, (_, i) => `$${i + offset}`).join(',');
}

export function cabinetRoutes(app: FastifyInstance, db: Db) {
  // ---------------------------------------------------------------------------
  // Cabinet dashboard - aggregated over every dossier the user can open
  // ---------------------------------------------------------------------------
  app.get('/cabinet/dashboard', async (req) => dashboardImpl(req));

  async function dashboardImpl(req: FastifyRequest) {
    const user = req.user!;
    const { companies } = await cabinetCompanies(db, user.id);
    const ids = companies.map((c) => c.id);
    const empty = {
      metrics: {
        clients: 0,
        active: 0,
        archived: 0,
        toReview: 0,
        openTasks: 0,
        overdueTasks: 0,
        dueSoon: 0,
        collaborators: 0,
      },
      tasksByCategory: [],
      upcoming: [],
      recentActivity: [],
      dossiers: [],
    };
    if (ids.length === 0) return empty;

    const ph = placeholders(ids.length, 1);
    const params = [...ids] as unknown[];

    const taskRows = await db.query<{
      company_id: string;
      category: string;
      status: string;
      due_date: string | null;
      priority: string;
    }>(
      `SELECT company_id, category, status, due_date, priority
         FROM cabinet_tasks
        WHERE company_id IN (${ph})`,
      params,
    );

    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const openStatuses = new Set(['todo', 'in_progress', 'blocked']);
    let openTasks = 0;
    let overdueTasks = 0;
    let dueSoon = 0;
    const byCategory = new Map<string, number>();
    const companiesWithOpenTasks = new Set<string>();

    for (const t of taskRows.rows) {
      if (!openStatuses.has(t.status)) continue;
      openTasks += 1;
      companiesWithOpenTasks.add(t.company_id);
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
      const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
      if (due && due < today) overdueTasks += 1;
      else if (due && due <= soon) dueSoon += 1;
    }

    const upcoming = await db.query(
      `SELECT t.id, t.title, t.category, t.priority, t.status, t.due_date,
              t.company_id, c.name AS company_name,
              u.full_name AS assignee_name
         FROM cabinet_tasks t
         JOIN companies c ON c.id = t.company_id
         LEFT JOIN app_users u ON u.id = t.assigned_to
        WHERE t.company_id IN (${ph})
          AND t.status IN ('todo', 'in_progress', 'blocked')
          AND t.due_date IS NOT NULL
        ORDER BY t.due_date ASC
        LIMIT 10`,
      params,
    );

    const collaborators = await db.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM company_members WHERE company_id IN (${ph})`,
      params,
    );

    const activity = await db.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
              c.name AS company_name, u.full_name AS user_name
         FROM audit_log a
         LEFT JOIN companies c ON c.id = a.company_id
         LEFT JOIN app_users u ON u.id = a.user_id
        WHERE a.company_id IN (${ph})
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 12`,
      params,
    );

    return {
      metrics: {
        clients: companies.length,
        active: companies.filter((c) => c.status === 'active').length,
        archived: companies.filter((c) => c.status === 'archived').length,
        toReview: companiesWithOpenTasks.size,
        openTasks,
        overdueTasks,
        dueSoon,
        collaborators: collaborators.rowCount,
      },
      tasksByCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
      upcoming: upcoming.rows,
      recentActivity: activity.rows,
      dossiers: companies.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        client_code: c.client_code,
        financial_year_end: c.financial_year_end,
        open_tasks: taskRows.rows.filter(
          (t) => t.company_id === c.id && openStatuses.has(t.status),
        ).length,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Dossier list (cabinet view) with search and filters
  // ---------------------------------------------------------------------------
  app.get('/cabinet/companies', async (req) => {
    const user = req.user!;
    const query = req.query as { search?: string; status?: string; manager?: string };
    const { companies } = await cabinetCompanies(db, user.id);
    const managerById = new Map<string, string>();
    if (companies.length > 0) {
      const managers = await db.query<{ id: string; full_name: string }>(
        `SELECT DISTINCT u.id, u.full_name
           FROM app_users u
           JOIN company_members m ON m.user_id = u.id
          WHERE m.company_id IN (${placeholders(companies.length, 1)})`,
        companies.map((c) => c.id),
      );
      for (const m of managers.rows) managerById.set(m.id, m.full_name);
    }
    let list = companies.map((c) => ({
      ...c,
      dossier_manager_name: c.dossier_manager_id
        ? managerById.get(c.dossier_manager_id) ?? null
        : null,
    }));
    if (query.status && query.status !== 'all') {
      list = list.filter((c) => c.status === query.status);
    }
    if (query.manager) {
      list = list.filter((c) => c.dossier_manager_id === query.manager);
    }
    if (query.search) {
      const needle = query.search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          (c.brn ?? '').toLowerCase().includes(needle) ||
          (c.client_code ?? '').toLowerCase().includes(needle),
      );
    }
    return { companies: list };
  });

  // ---------------------------------------------------------------------------
  // Dossier sheet
  // ---------------------------------------------------------------------------
  app.get('/cabinet/companies/:companyId', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'read');
    const companyRes = await db.query<CompanyRow>('SELECT * FROM companies WHERE id = $1', [
      companyId,
    ]);
    const company = companyRes.rows[0];
    if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

    const members = await db.query<{
      user_id: string;
      email: string;
      full_name: string;
      role: CompanyRole;
      is_active: boolean;
    }>(
      `SELECT m.user_id, u.email, u.full_name, m.role, u.is_active
         FROM company_members m JOIN app_users u ON u.id = m.user_id
        WHERE m.company_id = $1
        ORDER BY u.full_name`,
      [companyId],
    );

    const memberList = [];
    for (const m of members.rows) {
      memberList.push({
        ...m,
        modules: await effectiveModules(db, companyId, m.user_id, m.role),
      });
    }

    const tasks = await db.query<{ status: string } & Record<string, unknown>>(
      `SELECT t.*, u.full_name AS assignee_name
         FROM cabinet_tasks t LEFT JOIN app_users u ON u.id = t.assigned_to
        WHERE t.company_id = $1
        ORDER BY (t.due_date IS NULL), t.due_date ASC, t.created_at DESC`,
      [companyId],
    );
    const openTasks = tasks.rows.filter((t) => !['done', 'cancelled'].includes(t.status));

    const activity = await db.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.full_name AS user_name
         FROM audit_log a LEFT JOIN app_users u ON u.id = a.user_id
        WHERE a.company_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 15`,
      [companyId],
    );

    const manager = company.dossier_manager_id
      ? await db.query<{ id: string; full_name: string; email: string }>(
          'SELECT id, full_name, email FROM app_users WHERE id = $1',
          [company.dossier_manager_id],
        )
      : null;

    const counts = await db.query<{ entries: string; accounts: string }>(
      `SELECT (SELECT count(*) FROM journal_entries WHERE company_id = $1) AS entries,
              (SELECT count(*) FROM accounts WHERE company_id = $1) AS accounts`,
      [companyId],
    );

    const myRole = (
      await db.query<{ role: CompanyRole }>(
        'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
        [companyId, user.id],
      )
    ).rows[0]!.role;

    return {
      company,
      manager: manager?.rows[0] ?? null,
      role: myRole,
      modules: await effectiveModules(db, companyId, user.id, myRole),
      members: memberList,
      tasks: tasks.rows,
      openTasks,
      recentActivity: activity.rows,
      counts: {
        entries: Number(counts.rows[0]?.entries ?? 0),
        accounts: Number(counts.rows[0]?.accounts ?? 0),
        openTasks: openTasks.length,
        collaborators: memberList.length,
      },
    };
  });

  // ---------------------------------------------------------------------------
  // Archive / restore a dossier (accounting history is preserved)
  // ---------------------------------------------------------------------------
  app.post('/cabinet/companies/:companyId/archive', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'admin');
    const res = await db.query<CompanyRow>(
      `UPDATE companies
          SET status = 'archived', archived_at = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [companyId],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'cabinet.archive',
      entityType: 'company',
      entityId: companyId,
      ip: clientIp(req),
    });
    return { company: res.rows[0] };
  });

  app.post('/cabinet/companies/:companyId/unarchive', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'admin');
    const res = await db.query<CompanyRow>(
      `UPDATE companies
          SET status = 'active', archived_at = NULL, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [companyId],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'cabinet.unarchive',
      entityType: 'company',
      entityId: companyId,
      ip: clientIp(req),
    });
    return { company: res.rows[0] };
  });

  // ---------------------------------------------------------------------------
  // Collaborators: role changes and per-module grants
  // ---------------------------------------------------------------------------
  app.patch('/cabinet/companies/:companyId/members/:userId', async (req) => {
    const user = req.user!;
    const { companyId, userId } = req.params as { companyId: string; userId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'admin');
    const body = parse(
      z.object({
        role: z.enum(COMPANY_ROLES as [CompanyRole, ...CompanyRole[]]).optional(),
        isActive: z.boolean().optional(),
        modules: z
          .record(z.enum(['cabinet', 'accounting', 'billing', 'payroll']), z.enum(['none', 'read', 'write', 'admin']))
          .optional(),
      }),
      req.body,
    );

    const member = await db.query<{ role: CompanyRole }>(
      'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
      [companyId, userId],
    );
    if (!member.rows[0]) throw notFound('MEMBER_NOT_FOUND', 'Member not found');
    if (member.rows[0].role === 'owner' && body.role && body.role !== 'owner') {
      throw badRequest('VALIDATION_ERROR', 'The owner role cannot be changed here');
    }

    if (body.role) {
      await db.query('UPDATE company_members SET role = $3 WHERE company_id = $1 AND user_id = $2', [
        companyId,
        userId,
        body.role,
      ]);
    }
    if (body.isActive !== undefined) {
      await db.query('UPDATE app_users SET is_active = $2, updated_at = now() WHERE id = $1', [
        userId,
        body.isActive,
      ]);
    }
    if (body.modules) {
      for (const [module, access] of Object.entries(body.modules)) {
        if (access === 'none') {
          await db.query(
            'DELETE FROM company_module_access WHERE company_id = $1 AND user_id = $2 AND module = $3',
            [companyId, userId, module],
          );
        } else {
          await db.query(
            `INSERT INTO company_module_access (company_id, user_id, module, access, granted_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (company_id, user_id, module)
             DO UPDATE SET access = EXCLUDED.access, granted_by = EXCLUDED.granted_by, updated_at = now()`,
            [companyId, userId, module, access, user.id],
          );
        }
      }
    }
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'cabinet.member.update',
      entityType: 'user',
      entityId: userId,
      details: { role: body.role, modules: body.modules, isActive: body.isActive },
      ip: clientIp(req),
    });

    const updated = await db.query<{ role: CompanyRole }>(
      'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
      [companyId, userId],
    );
    return {
      member: {
        userId,
        role: updated.rows[0]!.role,
        modules: await effectiveModules(db, companyId, userId, updated.rows[0]!.role),
      },
    };
  });

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------
  app.get('/cabinet/tasks', async (req) => {
    const user = req.user!;
    const q = req.query as {
      status?: string;
      companyId?: string;
      assignedTo?: string;
      category?: string;
      overdue?: string;
      search?: string;
    };
    const { companies } = await cabinetCompanies(db, user.id);
    const ids = companies.map((c) => c.id);
    if (ids.length === 0) return { tasks: [] };
    const ph = placeholders(ids.length, 2);
    const params: unknown[] = [user.id, ...ids];
    const filters: string[] = [];

    if (q.companyId) {
      params.push(q.companyId);
      filters.push(`t.company_id = $${params.length}`);
    }
    if (q.status && q.status !== 'all') {
      params.push(q.status);
      filters.push(`t.status = $${params.length}`);
    }
    if (q.assignedTo) {
      params.push(q.assignedTo);
      filters.push(`t.assigned_to = $${params.length}`);
    }
    if (q.category && q.category !== 'all') {
      params.push(q.category);
      filters.push(`t.category = $${params.length}`);
    }
    if (q.overdue === '1') {
      filters.push(`t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
                    AND t.status IN ('todo','in_progress','blocked')`);
    }
    if (q.search) {
      params.push(`%${q.search}%`);
      filters.push(`(t.title ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }

    const res = await db.query(
      `SELECT t.*, c.name AS company_name, u.full_name AS assignee_name
         FROM cabinet_tasks t
         JOIN companies c ON c.id = t.company_id
         LEFT JOIN app_users u ON u.id = t.assigned_to
        WHERE t.company_id IN (${ph})
          ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
        ORDER BY (t.status IN ('done','cancelled')),
                 (t.due_date IS NULL), t.due_date ASC, t.created_at DESC
        LIMIT 200`,
      params,
    );
    return { tasks: res.rows };
  });

  app.get('/companies/:companyId/tasks', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'read');
    const res = await db.query(
      `SELECT t.*, u.full_name AS assignee_name
         FROM cabinet_tasks t LEFT JOIN app_users u ON u.id = t.assigned_to
        WHERE t.company_id = $1
        ORDER BY (t.status IN ('done','cancelled')), (t.due_date IS NULL), t.due_date ASC`,
      [companyId],
    );
    return { tasks: res.rows };
  });

  app.post('/companies/:companyId/tasks', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'write');
    const company = await db.query<CompanyRow>('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (company.rows[0]?.status === 'archived') {
      throw conflict('COMPANY_ARCHIVED', 'Archived dossier is read-only');
    }
    const body = parse(taskBody, req.body);

    if (body.assignedTo) {
      const member = await db.query(
        'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
        [companyId, body.assignedTo],
      );
      if (member.rowCount === 0) {
        throw badRequest('ASSIGNEE_NOT_MEMBER', 'The assignee is not a member of this dossier');
      }
    }

    const created = await db.query(
      `INSERT INTO cabinet_tasks
         (company_id, title, description, category, priority, status, due_date,
          assigned_to, created_by, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
               CASE WHEN $6 = 'done' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        companyId,
        body.title.trim(),
        body.description?.trim() || null,
        body.category,
        body.priority ?? 'normal',
        body.status ?? 'todo',
        body.dueDate ?? null,
        body.assignedTo ?? null,
        user.id,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'cabinet.task.create',
      entityType: 'cabinet_task',
      entityId: created.rows[0]!.id,
      details: { title: body.title, category: body.category },
      ip: clientIp(req),
    });
    return reply.code(201).send({ task: created.rows[0] });
  });

  app.get('/companies/:companyId/tasks/:taskId', async (req) => {
    const user = req.user!;
    const { companyId, taskId } = req.params as { companyId: string; taskId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'read');
    const task = await db.query(
      `SELECT t.*, u.full_name AS assignee_name, c.name AS company_name
         FROM cabinet_tasks t
         JOIN companies c ON c.id = t.company_id
         LEFT JOIN app_users u ON u.id = t.assigned_to
        WHERE t.id = $1 AND t.company_id = $2`,
      [taskId, companyId],
    );
    if (!task.rows[0]) throw notFound('TASK_NOT_FOUND', 'Task not found');
    const comments = await db.query(
      `SELECT cm.id, cm.body, cm.created_at, u.full_name AS author_name
         FROM cabinet_task_comments cm LEFT JOIN app_users u ON u.id = cm.author_id
        WHERE cm.task_id = $1 ORDER BY cm.created_at ASC`,
      [taskId],
    );
    const history = await db.query(
      `SELECT a.id, a.action, a.details, a.created_at, u.full_name AS user_name
         FROM audit_log a LEFT JOIN app_users u ON u.id = a.user_id
        WHERE a.entity_type = 'cabinet_task' AND a.entity_id = $1
        ORDER BY a.created_at DESC, a.id DESC LIMIT 30`,
      [taskId],
    );
    return { task: task.rows[0], comments: comments.rows, history: history.rows };
  });

  app.patch('/companies/:companyId/tasks/:taskId', async (req) => {
    const user = req.user!;
    const { companyId, taskId } = req.params as { companyId: string; taskId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'write');
    const body = parse(taskPatch, req.body);

    const current = await db.query<{ status: string; title: string }>(
      'SELECT status, title FROM cabinet_tasks WHERE id = $1 AND company_id = $2',
      [taskId, companyId],
    );
    if (!current.rows[0]) throw notFound('TASK_NOT_FOUND', 'Task not found');

    if (body.assignedTo) {
      const member = await db.query(
        'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
        [companyId, body.assignedTo],
      );
      if (member.rowCount === 0) {
        throw badRequest('ASSIGNEE_NOT_MEMBER', 'The assignee is not a member of this dossier');
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [taskId, companyId];
    const push = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (body.title !== undefined) push('title', body.title.trim());
    if (body.description !== undefined) push('description', body.description?.trim() || null);
    if (body.category !== undefined) push('category', body.category);
    if (body.priority !== undefined) push('priority', body.priority);
    if (body.status !== undefined) {
      push('status', body.status);
      fields.push(
        `completed_at = CASE WHEN $${values.length} = 'done' THEN now() ELSE NULL END`,
      );
    }
    if (body.dueDate !== undefined) push('due_date', body.dueDate ?? null);
    if (body.assignedTo !== undefined) push('assigned_to', body.assignedTo ?? null);
    if (fields.length === 0 && !body.comment) {
      throw badRequest('VALIDATION_ERROR', 'Nothing to update');
    }
    fields.push('updated_at = now()');

    const updated = await db.query(
      `UPDATE cabinet_tasks SET ${fields.join(', ')}
        WHERE id = $1 AND company_id = $2 RETURNING *`,
      values,
    );

    if (body.status && body.status !== current.rows[0].status) {
      await writeAudit(db, {
        companyId,
        userId: user.id,
        action: 'cabinet.task.status',
        entityType: 'cabinet_task',
        entityId: taskId,
        details: { from: current.rows[0].status, to: body.status },
        ip: clientIp(req),
      });
    } else {
      await writeAudit(db, {
        companyId,
        userId: user.id,
        action: 'cabinet.task.update',
        entityType: 'cabinet_task',
        entityId: taskId,
        details: { fields: Object.keys(body) },
        ip: clientIp(req),
      });
    }

    if (body.comment?.trim()) {
      await db.query(
        `INSERT INTO cabinet_task_comments (task_id, company_id, author_id, body)
         VALUES ($1,$2,$3,$4)`,
        [taskId, companyId, user.id, body.comment.trim()],
      );
    }

    return { task: updated.rows[0] };
  });

  app.post('/companies/:companyId/tasks/:taskId/comments', async (req, reply) => {
    const user = req.user!;
    const { companyId, taskId } = req.params as { companyId: string; taskId: string };
    await requireModuleAccess(db, user.id, companyId, 'cabinet', 'write');
    const body = parse(z.object({ body: z.string().min(1).max(4000) }), req.body);
    const task = await db.query('SELECT 1 FROM cabinet_tasks WHERE id = $1 AND company_id = $2', [
      taskId,
      companyId,
    ]);
    if (task.rowCount === 0) throw notFound('TASK_NOT_FOUND', 'Task not found');
    const created = await db.query(
      `INSERT INTO cabinet_task_comments (task_id, company_id, author_id, body)
       VALUES ($1,$2,$3,$4) RETURNING id, body, created_at`,
      [taskId, companyId, user.id, body.body.trim()],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'cabinet.task.comment',
      entityType: 'cabinet_task',
      entityId: taskId,
      ip: clientIp(req),
    });
    return reply.code(201).send({ comment: created.rows[0] });
  });

  app.delete('/companies/:companyId/tasks/:taskId', async (req) => {
    const user = req.user!;
    const { companyId, taskId } = req.params as { companyId: string; taskId: string };
    const ctx = await requireModuleAccess(db, user.id, companyId, 'cabinet', 'write');
    const task = await db.query<{ created_by: string | null }>(
      'SELECT created_by FROM cabinet_tasks WHERE id = $1 AND company_id = $2',
      [taskId, companyId],
    );
    if (!task.rows[0]) throw notFound('TASK_NOT_FOUND', 'Task not found');
    const isAdmin = ACCESS_WEIGHT[ctx.access] >= ACCESS_WEIGHT.admin;
    if (!isAdmin && task.rows[0].created_by !== user.id) {
      throw forbidden('Only a cabinet administrator or the task creator can delete a task');
    }
    await db.query('DELETE FROM cabinet_tasks WHERE id = $1 AND company_id = $2', [
      taskId,
      companyId,
    ]);
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'cabinet.task.delete',
      entityType: 'cabinet_task',
      entityId: taskId,
      ip: clientIp(req),
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Team: collaborators across the dossiers of the user
  // ---------------------------------------------------------------------------
  app.get('/cabinet/team', async (req) => {
    const user = req.user!;
    const { companies } = await cabinetCompanies(db, user.id);
    const ids = companies.map((c) => c.id);
    if (ids.length === 0) return { collaborators: [] };
    const ph = placeholders(ids.length, 1);
    const rows = await db.query<{
      user_id: string;
      full_name: string;
      email: string;
      is_active: boolean;
      company_id: string;
      company_name: string;
      role: CompanyRole;
    }>(
      `SELECT m.user_id, u.full_name, u.email, u.is_active,
              c.id AS company_id, c.name AS company_name, m.role
         FROM company_members m
         JOIN app_users u ON u.id = m.user_id
         JOIN companies c ON c.id = m.company_id
        WHERE m.company_id IN (${ph})
        ORDER BY u.full_name, c.name`,
      ids,
    );

    const byUser = new Map<string, {
      userId: string;
      fullName: string;
      email: string;
      isActive: boolean;
      assignments: { companyId: string; companyName: string; role: CompanyRole }[];
    }>();
    for (const row of rows.rows) {
      const entry = byUser.get(row.user_id) ?? {
        userId: row.user_id,
        fullName: row.full_name,
        email: row.email,
        isActive: row.is_active,
        assignments: [],
      };
      entry.assignments.push({
        companyId: row.company_id,
        companyName: row.company_name,
        role: row.role,
      });
      byUser.set(row.user_id, entry);
    }
    return { collaborators: [...byUser.values()] };
  });

  // ---------------------------------------------------------------------------
  // Dossier company fields are edited through the existing company endpoint;
  // this alias keeps the cabinet module self-contained for the UI.
  // ---------------------------------------------------------------------------
  app.patch('/cabinet/companies/:companyId', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'cabinet');
    const body = parse(
      z.object({
        dossierManagerId: z.string().uuid().nullish(),
        clientCode: z.string().max(24).nullish(),
        crn: z.string().max(40).nullish(),
        status: z.enum(['active', 'inactive', 'archived']).optional(),
      }),
      req.body,
    );
    const updated = await db.query<CompanyRow>(
      `UPDATE companies SET
         dossier_manager_id = COALESCE($2, dossier_manager_id),
         client_code = COALESCE($3, client_code),
         crn = COALESCE($4, crn),
         status = COALESCE($5, status),
         archived_at = CASE WHEN $5 = 'archived' AND archived_at IS NULL THEN now()
                            WHEN $5 IS NOT NULL AND $5 <> 'archived' THEN NULL
                            ELSE archived_at END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        companyId,
        body.dossierManagerId ?? null,
        body.clientCode ?? null,
        body.crn ?? null,
        body.status ?? null,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'cabinet.dossier.update',
      entityType: 'company',
      entityId: companyId,
      details: { fields: Object.keys(body) },
      ip: clientIp(req),
    });
    return { company: updated.rows[0] };
  });
}
