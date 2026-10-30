import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import { parseIsoDate } from '../../lib/dates.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import type { EntryRow, LineRow } from '../../types.js';
import {
  assertOpenPeriod,
  describeImbalance,
  insertLines,
  loadAccounts,
  loadJournal,
  nextEntryNo,
  prepareEntry,
  type EntryInput,
} from './service.js';

const lineSchema = z.object({
  accountId: z.string().uuid(),
  description: z.string().max(300).nullish(),
  debit: z.union([z.string(), z.number()]).nullish(),
  credit: z.union([z.string(), z.number()]).nullish(),
});

const entrySchema = z.object({
  journalId: z.string().uuid(),
  entryDate: z.string(),
  reference: z.string().max(100).nullish(),
  description: z.string().min(1).max(300),
  currency: z.string().length(3).optional(),
  exchangeRate: z.union([z.string(), z.number()]).nullish(),
  status: z.enum(['draft', 'posted']).optional(),
  lines: z.array(lineSchema).min(1).max(200),
});

async function assertAccounts(tx: Db, companyId: string, lines: { accountId: string }[]) {
  const { all, active } = await loadAccounts(
    tx,
    companyId,
    [...new Set(lines.map((l) => l.accountId))],
  );
  return { all, active };
}

/**
 * Business rule: a manually recorded reference must be unique within a company
 * (reversal entries are excluded, they inherit the original reference).
 * The same rule is enforced by a partial unique index in the database.
 */
async function assertReferenceAvailable(
  tx: Db,
  companyId: string,
  reference: string | null | undefined,
  excludeEntryId?: string,
): Promise<void> {
  const value = reference?.trim();
  if (!value) return;
  const res = await tx.query(
    `SELECT 1 FROM journal_entries
      WHERE company_id = $1 AND lower(btrim(reference)) = lower($2)
        AND source = 'manual' AND ($3::uuid IS NULL OR id <> $3::uuid)
      LIMIT 1`,
    [companyId, value, excludeEntryId ?? null],
  );
  if (res.rowCount > 0) {
    throw conflict('REFERENCE_TAKEN', `Reference "${value}" is already used in this company`);
  }
}

async function loadEntryDetail(db: Db, companyId: string, entryId: string) {
  const res = await db.query(
    `SELECT e.*, j.code AS journal_code, j.name AS journal_name, j.type AS journal_type,
            r.entry_no AS reversed_entry_no, r.id AS reversed_entry_id,
            rev.id AS reversal_entry_id, rev.entry_no AS reversal_entry_no
       FROM journal_entries e
       JOIN journals j ON j.id = e.journal_id
       LEFT JOIN journal_entries r ON r.id = e.reversal_of_entry_id
       LEFT JOIN journal_entries rev ON rev.reversal_of_entry_id = e.id
      WHERE e.id = $1 AND e.company_id = $2`,
    [entryId, companyId],
  );
  const entry = res.rows[0];
  if (!entry) throw notFound('ENTRY_NOT_FOUND', 'Journal entry not found');

  const lines = await db.query(
    `SELECT l.*, a.code AS account_code, a.name AS account_name, a.type AS account_type
       FROM journal_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id = $1 ORDER BY l.line_no`,
    [entryId],
  );
  const attachments = await db.query(
    'SELECT id, original_name, mime_type, size_bytes, created_at FROM attachments WHERE entry_id = $1',
    [entryId],
  );
  return { entry, lines: lines.rows, attachments: attachments.rows };
}

export function entryRoutes(app: FastifyInstance, db: Db, config: Config) {
  // -------------------------------------------------------------------------
  // List & read
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/entries', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer');

    const q = req.query as Record<string, string | undefined>;
    const where = ['e.company_id = $1'];
    const params: unknown[] = [companyId];
    if (q.status === 'draft' || q.status === 'posted') {
      params.push(q.status);
      where.push(`e.status = $${params.length}`);
    }
    if (q.journalId) {
      params.push(q.journalId);
      where.push(`e.journal_id = $${params.length}`);
    }
    if (q.from) {
      params.push(parseIsoDate(q.from, 'from'));
      where.push(`e.entry_date >= $${params.length}`);
    }
    if (q.to) {
      params.push(parseIsoDate(q.to, 'to'));
      where.push(`e.entry_date <= $${params.length}`);
    }
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      where.push(
        `(lower(e.entry_no) LIKE $${params.length} OR lower(coalesce(e.reference,'')) LIKE $${params.length} OR lower(e.description) LIKE $${params.length})`,
      );
    }

    const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

    const count = await db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM journal_entries e WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await db.query(
      `SELECT e.*, j.code AS journal_code, j.name AS journal_name,
              COALESCE(SUM(l.debit), 0)::text AS total_debit,
              (SELECT id FROM journal_entries r WHERE r.reversal_of_entry_id = e.id LIMIT 1) AS reversal_entry_id
         FROM journal_entries e
         JOIN journals j ON j.id = e.journal_id
         LEFT JOIN journal_lines l ON l.entry_id = e.id
        WHERE ${where.join(' AND ')}
        GROUP BY e.id, j.code, j.name
        ORDER BY e.entry_date DESC, e.entry_no DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return {
      entries: rows.rows,
      total: Number(count.rows[0]?.total ?? 0),
      limit,
      offset,
    };
  });

  app.get('/companies/:companyId/entries/:entryId', async (req) => {
    const user = req.user!;
    const { companyId, entryId } = req.params as { companyId: string; entryId: string };
    await requireCompany(db, user.id, companyId, 'viewer');
    return loadEntryDetail(db, companyId, entryId);
  });

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------
  app.post('/companies/:companyId/entries', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(entrySchema, req.body);
    const entryDate = parseIsoDate(body.entryDate, 'entryDate');
    const status = body.status ?? 'draft';

    const created = await db.transaction(async (tx) => {
      const journal = await loadJournal(tx, companyId, body.journalId);
      if (!journal.is_active) throw badRequest('VALIDATION_ERROR', 'Journal is inactive');

      const { all, active } = await assertAccounts(tx, companyId, body.lines);
      const prepared = prepareEntry(
        body as EntryInput,
        ctx.company.functional_currency,
        all,
        active,
      );

      await assertReferenceAvailable(tx, companyId, body.reference);

      if (status === 'posted') {
        if (!prepared.balanced) {
          throw badRequest('ENTRY_UNBALANCED', 'Debit and credit totals must be equal', {
            ...describeImbalance(prepared),
          });
        }
        await assertOpenPeriod(tx, companyId, entryDate);
      }

      const entryNo = await nextEntryNo(tx, companyId, journal, entryDate);
      const inserted = await tx.query<EntryRow>(
        `INSERT INTO journal_entries
           (company_id, journal_id, entry_no, entry_date, reference, description, currency,
            exchange_rate, status, source, created_by, posted_at, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12)
         RETURNING *`,
        [
          companyId,
          journal.id,
          entryNo,
          entryDate,
          body.reference?.trim() || null,
          body.description.trim(),
          prepared.currency,
          prepared.fxRate,
          status,
          user.id,
          status === 'posted' ? new Date() : null,
          status === 'posted' ? user.id : null,
        ],
      );
      const entry = inserted.rows[0]!;
      await insertLines(tx, entry.id, companyId, prepared);

      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: status === 'posted' ? 'entry.create_posted' : 'entry.create_draft',
        entityType: 'journal_entry',
        entityId: entry.id,
        details: { entryNo, debitTotal: formatAmount(prepared.debitTotal) },
        ip: clientIp(req),
      });
      return entry;
    });

    return reply.code(201).send(await loadEntryDetail(db, companyId, created.id));
  });

  // -------------------------------------------------------------------------
  // Update (drafts only)
  // -------------------------------------------------------------------------
  app.patch('/companies/:companyId/entries/:entryId', async (req) => {
    const user = req.user!;
    const { companyId, entryId } = req.params as { companyId: string; entryId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(entrySchema.partial(), req.body);

    await db.transaction(async (tx) => {
      const existing = await tx.query<EntryRow>(
        'SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2',
        [entryId, companyId],
      );
      const current = existing.rows[0];
      if (!current) throw notFound('ENTRY_NOT_FOUND', 'Journal entry not found');
      if (current.status === 'posted') {
        throw conflict(
          'ENTRY_POSTED_IMMUTABLE',
          'A posted entry cannot be modified; create a reversal entry instead',
        );
      }
      if (current.source === 'reversal') {
        throw conflict('ENTRY_POSTED_IMMUTABLE', 'A reversal entry cannot be modified');
      }

      const entryDate = body.entryDate ? parseIsoDate(body.entryDate, 'entryDate') : current.entry_date;
      const journal = body.journalId
        ? await loadJournal(tx, companyId, body.journalId)
        : await loadJournal(tx, companyId, current.journal_id);

      if (body.reference !== undefined) {
        await assertReferenceAvailable(tx, companyId, body.reference, entryId);
      }

      // A currency change must come with its own dated rate: reusing the
      // previous rate (often 1) would silently distort the functional amount.
      const nextCurrency = (body.currency ?? current.currency).toUpperCase();
      const currencyChanged = nextCurrency !== current.currency.toUpperCase();
      const targetIsForeign = nextCurrency !== ctx.company.functional_currency.toUpperCase();
      const effectiveRate = currencyChanged
        ? (body.exchangeRate ?? undefined)
        : (body.exchangeRate ?? current.exchange_rate);

      let prepared = null;
      if (body.lines) {
        if (currencyChanged && targetIsForeign && (body.exchangeRate === undefined || body.exchangeRate === null)) {
          throw badRequest(
            'EXCHANGE_RATE_REQUIRED',
            `An exchange rate is required when switching the entry to ${nextCurrency}`,
          );
        }
        const { all, active } = await assertAccounts(tx, companyId, body.lines);
        prepared = prepareEntry(
          {
            journalId: journal.id,
            entryDate,
            description: body.description ?? current.description,
            currency: nextCurrency,
            exchangeRate: effectiveRate,
            lines: body.lines,
          },
          ctx.company.functional_currency,
          all,
          active,
        );
      } else if (body.currency && currencyChanged && targetIsForeign) {
        throw badRequest(
          'EXCHANGE_RATE_REQUIRED',
          'Changing the currency requires resubmitting the entry lines with a dated rate',
        );
      }

      // Moving a draft to another journal or financial year must renumber it:
      // the entry number encodes journal code and year.
      const yearChanged = entryDate.slice(0, 4) !== current.entry_date.slice(0, 4);
      const journalChanged = journal.id !== current.journal_id;
      const newEntryNo =
        yearChanged || journalChanged
          ? await nextEntryNo(tx, companyId, journal, entryDate)
          : current.entry_no;

      await tx.query(
        `UPDATE journal_entries SET
           entry_no = $9,
           journal_id = $2, entry_date = $3,
           reference = CASE WHEN $4::boolean THEN $5::text ELSE reference END,
           description = COALESCE($6, description),
           currency = COALESCE($7, currency),
           exchange_rate = COALESCE($8, exchange_rate),
           updated_at = now()
         WHERE id = $1`,
        [
          entryId,
          journal.id,
          entryDate,
          body.reference !== undefined,
          body.reference?.trim() || null,
          body.description?.trim() ?? null,
          prepared?.currency ?? null,
          prepared?.fxRate ?? null,
          newEntryNo,
        ],
      );

      if (prepared) {
        await tx.query('DELETE FROM journal_lines WHERE entry_id = $1', [entryId]);
        await insertLines(tx, entryId, companyId, prepared);
      }

      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'entry.update_draft',
        entityType: 'journal_entry',
        entityId: entryId,
        details: { fields: Object.keys(body) },
        ip: clientIp(req),
      });
    });

    return loadEntryDetail(db, companyId, entryId);
  });

  app.delete('/companies/:companyId/entries/:entryId', async (req) => {
    const user = req.user!;
    const { companyId, entryId } = req.params as { companyId: string; entryId: string };
    await requireCompany(db, user.id, companyId, 'accountant');

    await db.transaction(async (tx) => {
      const existing = await tx.query<EntryRow>(
        'SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2',
        [entryId, companyId],
      );
      const current = existing.rows[0];
      if (!current) throw notFound('ENTRY_NOT_FOUND', 'Journal entry not found');
      if (current.status === 'posted') {
        throw conflict('ENTRY_POSTED_IMMUTABLE', 'A posted entry cannot be deleted');
      }
      const reversed = await tx.query(
        'SELECT 1 FROM journal_entries WHERE reversal_of_entry_id = $1',
        [entryId],
      );
      if (reversed.rowCount > 0) {
        throw conflict('ENTRY_POSTED_IMMUTABLE', 'This entry has been reversed and cannot be deleted');
      }
      const files = await tx.query<{ stored_name: string }>(
        'SELECT stored_name FROM attachments WHERE entry_id = $1 AND company_id = $2',
        [entryId, companyId],
      );
      await tx.query('DELETE FROM attachments WHERE entry_id = $1 AND company_id = $2', [
        entryId,
        companyId,
      ]);
      await tx.query('DELETE FROM journal_entries WHERE id = $1', [entryId]);

      // Remove the corresponding files from storage (best effort).
      for (const file of files.rows) {
        await unlink(path.resolve(config.STORAGE_DIR, companyId, file.stored_name)).catch(() => {});
      }

      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'entry.delete_draft',
        entityType: 'journal_entry',
        entityId: entryId,
        details: { entryNo: current.entry_no },
        ip: clientIp(req),
      });
    });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Post
  // -------------------------------------------------------------------------
  app.post('/companies/:companyId/entries/:entryId/post', async (req) => {
    const user = req.user!;
    const { companyId, entryId } = req.params as { companyId: string; entryId: string };
    await requireCompany(db, user.id, companyId, 'accountant');

    await db.transaction(async (tx) => {
      const existing = await tx.query<EntryRow>(
        'SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2',
        [entryId, companyId],
      );
      const current = existing.rows[0];
      if (!current) throw notFound('ENTRY_NOT_FOUND', 'Journal entry not found');
      if (current.status === 'posted') {
        throw conflict('ENTRY_POSTED_IMMUTABLE', 'Entry is already posted');
      }

      const lines = await tx.query<LineRow>('SELECT * FROM journal_lines WHERE entry_id = $1', [
        entryId,
      ]);
      if (lines.rows.length < 2) {
        throw badRequest('ENTRY_TOO_FEW_LINES', 'An entry must have at least two lines');
      }

      // Accounts may have been deactivated since the draft was written.
      const usable = await tx.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.entry_id = $1 AND a.company_id = $2 AND a.is_active = true`,
        [entryId, companyId],
      );
      if (Number(usable.rows[0]?.count ?? '0') !== lines.rows.length) {
        throw badRequest(
          'VALIDATION_ERROR',
          'The entry references an account that is inactive or from another company',
        );
      }
      const debit = lines.rows.reduce((a, l) => a + parseAmount(l.debit), 0n);
      const credit = lines.rows.reduce((a, l) => a + parseAmount(l.credit), 0n);
      if (debit !== credit) {
        throw badRequest('ENTRY_UNBALANCED', 'Debit and credit totals must be equal', {
          debitTotal: formatAmount(debit),
          creditTotal: formatAmount(credit),
          difference: formatAmount(debit - credit),
        });
      }

      await assertOpenPeriod(tx, companyId, current.entry_date);
      await tx.query(
        `UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2,
                updated_at = now() WHERE id = $1`,
        [entryId, user.id],
      );
      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'entry.post',
        entityType: 'journal_entry',
        entityId: entryId,
        details: { entryNo: current.entry_no },
        ip: clientIp(req),
      });
    });

    return loadEntryDetail(db, companyId, entryId);
  });

  // -------------------------------------------------------------------------
  // Reverse (contrepassation)
  // -------------------------------------------------------------------------
  app.post('/companies/:companyId/entries/:entryId/reverse', async (req, reply) => {
    const user = req.user!;
    const { companyId, entryId } = req.params as { companyId: string; entryId: string };
    await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(
      z.object({
        entryDate: z.string().optional(),
        description: z.string().max(300).optional(),
      }),
      req.body ?? {},
    );

    const reversal = await db.transaction(async (tx) => {
      const existing = await tx.query<EntryRow>(
        'SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2',
        [entryId, companyId],
      );
      const original = existing.rows[0];
      if (!original) throw notFound('ENTRY_NOT_FOUND', 'Journal entry not found');
      if (original.status !== 'posted') {
        throw badRequest('ENTRY_NOT_DRAFT', 'Only a posted entry can be reversed');
      }
      const already = await tx.query(
        'SELECT 1 FROM journal_entries WHERE reversal_of_entry_id = $1',
        [entryId],
      );
      if (already.rowCount > 0) {
        throw conflict('ENTRY_ALREADY_REVERSED', 'This entry has already been reversed');
      }

      const entryDate = body.entryDate
        ? parseIsoDate(body.entryDate, 'entryDate')
        : original.entry_date;
      await assertOpenPeriod(tx, companyId, entryDate);

      const journal = await loadJournal(tx, companyId, original.journal_id);
      const entryNo = await nextEntryNo(tx, companyId, journal, entryDate);

      const inserted = await tx.query<EntryRow>(
        `INSERT INTO journal_entries
           (company_id, journal_id, entry_no, entry_date, reference, description, currency,
            exchange_rate, status, source, reversal_of_entry_id, created_by, posted_at, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted','reversal',$9,$10,now(),$10)
         RETURNING *`,
        [
          companyId,
          journal.id,
          entryNo,
          entryDate,
          original.reference,
          body.description?.trim() || `Reversal of ${original.entry_no}`,
          original.currency,
          original.exchange_rate,
          original.id,
          user.id,
        ],
      );
      const newEntry = inserted.rows[0]!;

      const originalLines = await tx.query<LineRow>(
        'SELECT * FROM journal_lines WHERE entry_id = $1 ORDER BY line_no',
        [entryId],
      );
      for (const line of originalLines.rows) {
        await tx.query(
          `INSERT INTO journal_lines
             (entry_id, company_id, line_no, account_id, description, debit, credit,
              txn_currency, txn_amount, fx_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            newEntry.id,
            companyId,
            line.line_no,
            line.account_id,
            line.description,
            line.credit, // swapped
            line.debit,
            line.txn_currency,
            line.txn_amount,
            line.fx_rate,
          ],
        );
      }

      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'entry.reverse',
        entityType: 'journal_entry',
        entityId: newEntry.id,
        details: { reverses: original.entry_no, entryNo },
        ip: clientIp(req),
      });
      return newEntry;
    });

    return reply.code(201).send(await loadEntryDetail(db, companyId, reversal.id));
  });
}
