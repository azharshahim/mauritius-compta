import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { clientIp } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/**
 * The browser-supplied MIME type is not trustworthy: the file signature is
 * verified and must match the declared type before anything is written.
 */
function detectSignature(buffer: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

export function attachmentRoutes(app: FastifyInstance, db: Db, config: Config) {
  app.post('/companies/:companyId/entries/:entryId/attachments', async (req, reply) => {
    const user = req.user!;
    const { companyId, entryId } = req.params as { companyId: string; entryId: string };
    await requireCompany(db, user.id, companyId, 'accountant');

    const entry = await db.query('SELECT id FROM journal_entries WHERE id = $1 AND company_id = $2', [
      entryId,
      companyId,
    ]);
    if (entry.rowCount === 0) throw notFound('ENTRY_NOT_FOUND', 'Journal entry not found');

    const file = await req.file({ limits: { fileSize: config.MAX_UPLOAD_BYTES } });
    if (!file) throw badRequest('VALIDATION_ERROR', 'No file uploaded');
    const mime = file.mimetype;
    if (!ALLOWED.has(mime)) {
      throw badRequest('ATTACHMENT_TYPE_NOT_ALLOWED', 'Only PDF, JPEG and PNG files are allowed');
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength > config.MAX_UPLOAD_BYTES) {
      throw badRequest('ATTACHMENT_TOO_LARGE', 'File is too large');
    }
    if (buffer.byteLength === 0) {
      throw badRequest('VALIDATION_ERROR', 'The uploaded file is empty');
    }
    const signature = detectSignature(buffer);
    if (!signature || signature !== mime) {
      throw badRequest(
        'ATTACHMENT_TYPE_NOT_ALLOWED',
        'The file content does not match an allowed format (PDF, JPEG, PNG)',
      );
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const storedName = `${randomUUID()}${EXT[mime] ?? ''}`;
    const dir = path.resolve(config.STORAGE_DIR, companyId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, storedName), buffer);

    const inserted = await db.query(
      `INSERT INTO attachments
         (company_id, entry_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, original_name, mime_type, size_bytes, created_at`,
      [
        companyId,
        entryId,
        file.filename.slice(0, 200),
        storedName,
        mime,
        buffer.byteLength,
        sha256,
        user.id,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'attachment.upload',
      entityType: 'attachment',
      entityId: String((inserted.rows[0] as { id: string }).id),
      details: { entryId, name: file.filename, size: buffer.byteLength },
      ip: clientIp(req),
    });
    return reply.code(201).send({ attachment: inserted.rows[0] });
  });

  app.get('/companies/:companyId/attachments/:attachmentId', async (req, reply) => {
    const user = req.user!;
    const { companyId, attachmentId } = req.params as { companyId: string; attachmentId: string };
    await requireCompany(db, user.id, companyId, 'viewer');
    const res = await db.query<{
      stored_name: string;
      original_name: string;
      mime_type: string;
    }>('SELECT stored_name, original_name, mime_type FROM attachments WHERE id = $1 AND company_id = $2', [
      attachmentId,
      companyId,
    ]);
    const row = res.rows[0];
    if (!row) throw notFound('NOT_FOUND', 'Attachment not found');
    const filePath = path.resolve(config.STORAGE_DIR, companyId, row.stored_name);
    try {
      await stat(filePath);
    } catch {
      throw notFound('NOT_FOUND', 'Attachment file is missing from storage');
    }
    reply
      .header('content-type', row.mime_type)
      .header(
        'content-disposition',
        `inline; filename="${row.original_name.replace(/["\\\r\n]/g, '_')}"`,
      )
      .header('x-content-type-options', 'nosniff');
    return reply.send(createReadStream(filePath));
  });

  app.delete('/companies/:companyId/attachments/:attachmentId', async (req) => {
    const user = req.user!;
    const { companyId, attachmentId } = req.params as { companyId: string; attachmentId: string };
    await requireCompany(db, user.id, companyId, 'accountant');
    const res = await db.query<{ stored_name: string }>(
      'SELECT stored_name FROM attachments WHERE id = $1 AND company_id = $2',
      [attachmentId, companyId],
    );
    const row = res.rows[0];
    if (!row) throw notFound('NOT_FOUND', 'Attachment not found');
    await db.query('DELETE FROM attachments WHERE id = $1 AND company_id = $2', [
      attachmentId,
      companyId,
    ]);
    try {
      await unlink(path.resolve(config.STORAGE_DIR, companyId, row.stored_name));
    } catch {
      /* file may already be gone */
    }
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'attachment.delete',
      entityType: 'attachment',
      entityId: attachmentId,
      ip: clientIp(req),
    });
    return { ok: true };
  });
}
