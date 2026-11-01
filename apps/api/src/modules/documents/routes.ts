import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { parse } from '../../lib/http.js';
import { clientIp } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import {
  approveProposal, documentFile, generateProposal, getDocument, listDocumentRules,
  listDocuments, partyCandidates, rejectProposal, updateDocument, updateDocumentRule,
  uploadDocument,
} from './service.js';

const financialYear = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const UploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
  declaredMime: z.enum(['application/pdf', 'image/jpeg', 'image/png']).optional(),
  kind: z.enum(['purchase', 'sale']),
});
const UpdateSchema = z.object({
  kind: z.enum(['purchase', 'sale']).optional(),
  party_name: z.string().trim().max(200).nullish(),
  invoice_number: z.string().trim().max(80).nullish(),
  invoice_date: financialYear,
  due_date: financialYear,
  currency: z.string().length(3).nullish(),
  subtotal: z.union([z.string(), z.number()]).nullish(),
  vat_total: z.union([z.string(), z.number()]).nullish(),
  total_amount: z.union([z.string(), z.number()]).nullish(),
}).strict();
const ApprovalSchema = z.object({
  confirm: z.literal(true),
  partyId: z.string().uuid().nullish(),
  journalId: z.string().uuid().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(100).nullish(),
  exchangeRate: z.union([z.string(), z.number()]).nullish(),
  lines: z.array(z.object({
    accountId: z.string().uuid(),
    description: z.string().max(300).nullish(),
    debit: z.union([z.string(), z.number()]).nullish(),
    credit: z.union([z.string(), z.number()]).nullish(),
  })).min(2).max(200),
}).strict();
const RejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const RuleUpdateSchema = z.object({
  accountId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => value.accountId !== undefined || value.isActive !== undefined, {
  message: 'At least one rule field is required',
});

export function documentRoutes(app: FastifyInstance, db: Db, config: Config) {
  const base = '/companies/:companyId/documents';

  app.post(base, { bodyLimit: 12_000_000 }, async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(UploadSchema, req.body);
    const result = await uploadDocument(db, config, { userId: req.user!.id, companyId, ip: req.ip }, body);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'document.upload',
      entityType: 'document', entityId: result.document.id,
      details: { method: result.document.extraction_method, sha256: result.document.sha256 }, ip: clientIp(req) });
    return reply.code(201).send(result);
  });

  app.get(base, async (req) => {
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = req.query as { status?: string };
    return { documents: await listDocuments(db, companyId, q.status) };
  });

  // Static routes must be declared before `/:documentId`.
  app.get(`${base}/rules`, async (req) => {
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return { rules: await listDocumentRules(db, companyId) };
  });

  app.patch(`${base}/rules/:ruleId`, async (req) => {
    const { companyId, ruleId } = req.params as { companyId: string; ruleId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(RuleUpdateSchema, req.body);
    const rule = await updateDocumentRule(db, companyId, ruleId, body);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'document.rule.update',
      entityType: 'document_mapping', entityId: ruleId,
      details: { accountId: body.accountId ?? null, isActive: body.isActive ?? null }, ip: clientIp(req) });
    return { rule };
  });

  app.get(`${base}/:documentId`, async (req) => {
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return getDocument(db, companyId, documentId);
  });

  app.get(`${base}/:documentId/file`, async (req, reply) => {
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const file = await documentFile(db, config, companyId, documentId);
    return reply.type(file.mimeType)
      .header('content-disposition', `inline; filename="${file.fileName.replace(/[^\w.\-]/g, '_')}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(file.buffer);
  });

  app.patch(`${base}/:documentId`, async (req) => {
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(UpdateSchema, req.body);
    const document = await updateDocument(db, companyId, documentId, body);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'document.correct',
      entityType: 'document', entityId: documentId, details: { fields: Object.keys(body) }, ip: clientIp(req) });
    return { document };
  });

  app.post(`${base}/:documentId/proposal`, async (req, reply) => {
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const result = await generateProposal(db, { userId: req.user!.id, companyId }, documentId);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'document.propose',
      entityType: 'document', entityId: documentId, details: { balanced: result.proposal.balanced }, ip: clientIp(req) });
    return reply.code(201).send(result);
  });

  app.get(`${base}/:documentId/party-candidates`, async (req) => {
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const detail = await getDocument(db, companyId, documentId);
    return { candidates: await partyCandidates(db, companyId,
      detail.document.kind === 'sale' ? 'sale' : 'purchase', detail.document.party_name) };
  });

  app.post(`${base}/proposals/:proposalId/approve`, async (req) => {
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(ApprovalSchema, req.body);
    const result = await approveProposal(db, { userId: req.user!.id, companyId }, proposalId, body);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'document.proposal.approve',
      entityType: 'document_proposal', entityId: proposalId,
      details: { draftEntryId: result.draftEntry.id }, ip: clientIp(req) });
    return result;
  });

  app.post(`${base}/proposals/:proposalId/reject`, async (req) => {
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(RejectSchema, req.body);
    const result = await rejectProposal(db, { userId: req.user!.id, companyId }, proposalId, body.reason);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'document.proposal.reject',
      entityType: 'document_proposal', entityId: proposalId, details: { reason: body.reason }, ip: clientIp(req) });
    return result;
  });
}
