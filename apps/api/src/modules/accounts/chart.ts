/**
 * Mission 23 — bilingual chart of accounts and controlled chart imports.
 * No account number is asserted as mandatory. A provisional template is
 * explicitly labelled as awaiting professional validation, and imports never
 * renumber, overwrite or delete existing accounts.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { parse, clientIp } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import { parseUpload } from '../migration/parse.js';

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const Uuid = z.string().uuid();
const TemplateSchema = z.object({ template: z.enum(['provisional_mauritius', 'custom_company']) });
const ImportPreviewSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
  sheetName: z.string().max(120).nullish(),
  mapping: z.object({
    code: z.string().max(120).nullish(), name: z.string().max(120).nullish(),
    nameEn: z.string().max(120).nullish(), nameFr: z.string().max(120).nullish(),
    type: z.string().max(120).nullish(), parentCode: z.string().max(120).nullish(),
    postingAllowed: z.string().max(120).nullish(), accountRole: z.string().max(120).nullish(),
  }).optional(),
});
const ImportConfirmSchema = ImportPreviewSchema.extend({
  confirm: z.literal(true),
  rows: z.array(z.object({
    code: z.string().trim().min(1).max(30),
    name: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().max(200).nullish(),
    nameFr: z.string().trim().max(200).nullish(),
    type: z.enum(TYPES),
    parentCode: z.string().trim().max(30).nullish(),
    postingAllowed: z.boolean(),
    accountRole: z.string().trim().max(60).nullish(),
  })).min(1).max(2000),
});

export interface ProvisionalAccount {
  code: string; nameEn: string; nameFr: string; type: (typeof TYPES)[number];
  parentCode: string | null; postingAllowed: boolean; accountRole: string | null;
}
/** Demonstration template only: not an official Mauritian chart. */
export const PROVISIONAL_TEMPLATE: ProvisionalAccount[] = [
  { code: '1010', nameEn: 'Cash and bank', nameFr: 'Caisse et banque', type: 'asset', parentCode: null, postingAllowed: true, accountRole: 'bank' },
  { code: '1100', nameEn: 'Trade receivables', nameFr: 'Clients', type: 'asset', parentCode: null, postingAllowed: true, accountRole: 'receivable' },
  { code: '1150', nameEn: 'Advances to suppliers', nameFr: 'Avances aux fournisseurs', type: 'asset', parentCode: null, postingAllowed: true, accountRole: 'prepayment' },
  { code: '1200', nameEn: 'VAT recoverable', nameFr: 'TVA récupérable', type: 'asset', parentCode: null, postingAllowed: true, accountRole: 'vat_input' },
  { code: '1300', nameEn: 'Inventory', nameFr: 'Stocks', type: 'asset', parentCode: null, postingAllowed: true, accountRole: 'inventory' },
  { code: '1400', nameEn: 'Prepayments', nameFr: 'Charges constatées d’avance', type: 'asset', parentCode: null, postingAllowed: true, accountRole: 'prepaid_expense' },
  { code: '1500', nameEn: 'Property, plant and equipment', nameFr: 'Immobilisations corporelles', type: 'asset', parentCode: null, postingAllowed: true, accountRole: 'fixed_asset' },
  { code: '1510', nameEn: 'Accumulated depreciation', nameFr: 'Amortissements cumulés', type: 'asset', parentCode: '1500', postingAllowed: true, accountRole: 'accumulated_depreciation' },
  { code: '2000', nameEn: 'Trade payables', nameFr: 'Fournisseurs', type: 'liability', parentCode: null, postingAllowed: true, accountRole: 'payable' },
  { code: '2100', nameEn: 'Accrued liabilities', nameFr: 'Dettes à payer', type: 'liability', parentCode: null, postingAllowed: true, accountRole: 'accrued_liability' },
  { code: '2200', nameEn: 'VAT payable', nameFr: 'TVA à payer', type: 'liability', parentCode: null, postingAllowed: true, accountRole: 'vat_output' },
  { code: '2300', nameEn: 'Deferred income', nameFr: 'Produits constatés d’avance', type: 'liability', parentCode: null, postingAllowed: true, accountRole: 'deferred_income' },
  { code: '2400', nameEn: 'Provisions', nameFr: 'Provisions', type: 'liability', parentCode: null, postingAllowed: true, accountRole: 'provision' },
  { code: '2500', nameEn: 'Loans', nameFr: 'Emprunts', type: 'liability', parentCode: null, postingAllowed: true, accountRole: 'loan' },
  { code: '3000', nameEn: 'Share capital', nameFr: 'Capital social', type: 'equity', parentCode: null, postingAllowed: true, accountRole: 'capital' },
  { code: '3100', nameEn: 'Retained earnings', nameFr: 'Report à nouveau', type: 'equity', parentCode: null, postingAllowed: true, accountRole: 'retained_earnings' },
  { code: '3200', nameEn: 'Current-year result', nameFr: 'Résultat de l’exercice', type: 'equity', parentCode: null, postingAllowed: true, accountRole: 'result' },
  { code: '4000', nameEn: 'Sales of goods', nameFr: 'Ventes de marchandises', type: 'revenue', parentCode: null, postingAllowed: true, accountRole: 'revenue' },
  { code: '4010', nameEn: 'Services revenue', nameFr: 'Prestations de services', type: 'revenue', parentCode: null, postingAllowed: true, accountRole: 'service_revenue' },
  { code: '4900', nameEn: 'Other income', nameFr: 'Autres produits', type: 'revenue', parentCode: null, postingAllowed: true, accountRole: 'other_income' },
  { code: '5000', nameEn: 'Purchases of goods', nameFr: 'Achats de marchandises', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'purchases' },
  { code: '5100', nameEn: 'Inventory adjustments', nameFr: 'Variations de stocks', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'inventory_adjustment' },
  { code: '6000', nameEn: 'External services', nameFr: 'Services externes', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'external_services' },
  { code: '6100', nameEn: 'Rent', nameFr: 'Loyers', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'rent' },
  { code: '6110', nameEn: 'Utilities', nameFr: 'Eau et électricité', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'utilities' },
  { code: '6120', nameEn: 'Telecommunications', nameFr: 'Télécommunications', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'telecom' },
  { code: '6130', nameEn: 'Professional services', nameFr: 'Honoraires professionnels', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'professional_fees' },
  { code: '6140', nameEn: 'Insurance', nameFr: 'Assurances', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'insurance' },
  { code: '6200', nameEn: 'Depreciation and impairment', nameFr: 'Amortissements et dépréciations', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'depreciation' },
  { code: '6300', nameEn: 'Staff costs', nameFr: 'Charges de personnel', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'payroll' },
  { code: '6400', nameEn: 'Bank charges', nameFr: 'Frais bancaires', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'bank_charges' },
  { code: '6900', nameEn: 'Other expenses', nameFr: 'Autres charges', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'other_expense' },
];

const ALIASES: Record<string, string[]> = {
  code: ['code', 'account number', 'account no', 'numero', 'numéro', 'n°', 'compte'],
  name: ['name', 'label', 'libelle', 'libellé', 'account name', 'intitule', 'intitulé'],
  nameEn: ['name en', 'english', 'label en', 'libelle anglais', 'english label'],
  nameFr: ['name fr', 'french', 'label fr', 'libelle francais', 'libellé français'],
  type: ['type', 'category', 'categorie', 'catégorie', 'account type'],
  parentCode: ['parent', 'parent code', 'compte parent'],
  postingAllowed: ['posting', 'posting allowed', 'imputable', 'saisie'],
  accountRole: ['role', 'rôle', 'account role', 'mapping'],
};
function pick(headers: string[], explicit: string | null | undefined, key: string): number {
  if (explicit) {
    const exact = headers.findIndex((h) => h.trim().toLowerCase() === explicit.trim().toLowerCase());
    if (exact >= 0) return exact;
  }
  const aliases = ALIASES[key] ?? [];
  return headers.findIndex((h) => aliases.includes(h.trim().toLowerCase()));
}
function normaliseType(raw: string): (typeof TYPES)[number] | null {
  const v = raw.trim().toLowerCase();
  if ((TYPES as readonly string[]).includes(v)) return v as (typeof TYPES)[number];
  const map: Record<string, (typeof TYPES)[number]> = {
    actif: 'asset', asset: 'asset', passif: 'liability', liability: 'liability',
    capitaux: 'equity', equity: 'equity', produit: 'revenue', revenue: 'revenue',
    income: 'revenue', charge: 'expense', expense: 'expense', dépense: 'expense',
  };
  return map[v] ?? null;
}
function truthy(raw: string): boolean {
  return !['false', 'no', 'non', '0', 'n'].includes(raw.trim().toLowerCase());
}
function decode(base64: string, max: number): Uint8Array {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw badRequest('CHART_FILE_EMPTY', 'The file is empty');
  if (bytes.length > max) throw badRequest('CHART_FILE_TOO_LARGE', 'The chart file is too large');
  return bytes;
}

export function chartRoutes(app: FastifyInstance, db: Db) {
  const base = '/companies/:companyId/chart-of-accounts';
  async function profile(companyId: string) {
    const res = await db.query<any>('SELECT * FROM chart_profiles WHERE company_id=$1', [companyId]);
    if (res.rows[0]) return res.rows[0];
    return {
      company_id: companyId, template_type: 'provisional_mauritius',
      status: 'PENDING PROFESSIONAL VALIDATION', source_name: null, source_sha256: null,
      imported_at: null, confirmed_at: null, confirmed_by: null,
      notes: 'Default profile. No chart is presented as officially mandatory.',
      updated_at: null,
    };
  }

  app.get(`${base}/profile`, async (req) => {
    const { companyId } = req.params as any;
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return { profile: await profile(companyId) };
  });

  app.get(`${base}/template`, async (req) => {
    const { companyId } = req.params as any;
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return { template: 'provisional_mauritius', status: 'PENDING PROFESSIONAL VALIDATION',
      note: 'Demonstration template only. Account numbers are not asserted as mandatory.',
      accounts: PROVISIONAL_TEMPLATE };
  });

  app.post(`${base}/template/apply`, async (req) => {
    const { companyId } = req.params as any;
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    parse(TemplateSchema, req.body ?? {});
    const existing = await db.query<any>('SELECT id, code FROM accounts WHERE company_id=$1', [companyId]);
    const codes = new Set(existing.rows.map((r) => String(r.code).toLowerCase()));
    let created = 0;
    const parentIds = new Map<string, string>(
      existing.rows.map((r) => [String(r.code).toLowerCase(), r.id]),
    );
    for (const acc of PROVISIONAL_TEMPLATE) {
      if (codes.has(acc.code.toLowerCase())) continue;
      const parentId = acc.parentCode ? parentIds.get(acc.parentCode.toLowerCase()) ?? null : null;
      const row = await db.query<any>(
        `INSERT INTO accounts (company_id, code, name, name_en, name_fr, type, parent_id,
           currency, is_active, posting_allowed, account_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT functional_currency FROM companies WHERE id=$1),true,$8,$9)
         RETURNING id`, [companyId, acc.code, acc.nameEn, acc.nameEn, acc.nameFr, acc.type, parentId,
          acc.postingAllowed, acc.accountRole]);
      parentIds.set(acc.code.toLowerCase(), row.rows[0].id);
      created += 1;
    }
    await db.query(
      `INSERT INTO chart_profiles (company_id, template_type, status, notes)
       VALUES ($1,'provisional_mauritius','PENDING PROFESSIONAL VALIDATION',
         'Provisional demonstration template applied by the company.')
       ON CONFLICT (company_id) DO UPDATE SET template_type='provisional_mauritius',
         status='PENDING PROFESSIONAL VALIDATION', updated_at=now()`, [companyId]);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'chart.template.apply',
      entityType: 'chart_profile', entityId: companyId, details: { created }, ip: clientIp(req) });
    return { created, skipped: PROVISIONAL_TEMPLATE.length - created,
      status: 'PENDING PROFESSIONAL VALIDATION' };
  });

  app.post(`${base}/import/preview`, async (req) => {
    const { companyId } = req.params as any;
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(ImportPreviewSchema, req.body);
    let parsed;
    try { parsed = parseUpload(body.fileName, decode(body.contentBase64, 8 * 1024 * 1024)); }
    catch (error) { throw badRequest('CHART_PARSE_FAILED', (error as Error).message); }
    const sheet = parsed.sheets.find((s) => !body.sheetName || s.name === body.sheetName) ?? parsed.sheets[0];
    if (!sheet) throw badRequest('CHART_NO_SHEET', 'No readable sheet');
    const m = body.mapping ?? {};
    const idx = {
      code: pick(sheet.headers, m.code, 'code'), name: pick(sheet.headers, m.name, 'name'),
      nameEn: pick(sheet.headers, m.nameEn, 'nameEn'), nameFr: pick(sheet.headers, m.nameFr, 'nameFr'),
      type: pick(sheet.headers, m.type, 'type'), parentCode: pick(sheet.headers, m.parentCode, 'parentCode'),
      postingAllowed: pick(sheet.headers, m.postingAllowed, 'postingAllowed'),
      accountRole: pick(sheet.headers, m.accountRole, 'accountRole'),
    };
    if (idx.code < 0 || idx.type < 0) {
      throw badRequest('CHART_REQUIRED_MAPPING_MISSING', 'Account code and type columns must be mapped');
    }
    const existing = await db.query<any>('SELECT code, name FROM accounts WHERE company_id=$1', [companyId]);
    const existingCodes = new Set(existing.rows.map((r) => String(r.code).toLowerCase()));
    const seen = new Set<string>();
    const rows: any[] = [];
    const findings: any[] = [];
    sheet.rows.forEach((row, i) => {
      const line = i + 2;
      const code = String(row[idx.code] ?? '').trim();
      if (!code) return;
      const type = normaliseType(String(row[idx.type] ?? ''));
      const name = String(row[idx.name] ?? row[idx.nameEn] ?? row[idx.nameFr] ?? '').trim();
      if (!name) findings.push({ line, code, codeName: 'CHART_NAME_MISSING', severity: 'error' });
      if (!type) findings.push({ line, code, codeName: 'CHART_TYPE_INVALID', severity: 'error' });
      if (existingCodes.has(code.toLowerCase())) findings.push({ line, code, codeName: 'CHART_DUPLICATE_EXISTING', severity: 'warning' });
      if (seen.has(code.toLowerCase())) findings.push({ line, code, codeName: 'CHART_DUPLICATE_FILE', severity: 'error' });
      seen.add(code.toLowerCase());
      rows.push({ line, code, name: name || code, nameEn: String(row[idx.nameEn] ?? '').trim() || null,
        nameFr: String(row[idx.nameFr] ?? '').trim() || null, type,
        parentCode: String(row[idx.parentCode] ?? '').trim() || null,
        postingAllowed: idx.postingAllowed < 0 ? true : truthy(String(row[idx.postingAllowed] ?? 'true')),
        accountRole: String(row[idx.accountRole] ?? '').trim() || null,
        exists: existingCodes.has(code.toLowerCase()) });
    });
    return { format: parsed.format, sheetName: sheet.name, headers: sheet.headers, mapping: idx,
      rows, findings, notes: parsed.notes, profileStatus: 'AWAITING FIRM CONFIRMATION',
      mappingRequired: idx.code < 0 || idx.type < 0 };
  });

  app.post(`${base}/import/confirm`, async (req) => {
    const { companyId } = req.params as any;
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(ImportConfirmSchema, req.body);
    const existing = await db.query<any>('SELECT id, code FROM accounts WHERE company_id=$1', [companyId]);
    const codes = new Set(existing.rows.map((r) => String(r.code).toLowerCase()));
    const result = await db.transaction(async (tx) => {
      let created = 0; const skipped: string[] = [];
      const ids = new Map<string, string>(existing.rows.map((r) => [String(r.code).toLowerCase(), r.id]));
      for (const row of body.rows) {
        if (codes.has(row.code.toLowerCase())) { skipped.push(row.code); continue; }
        const parentId = row.parentCode ? ids.get(row.parentCode.toLowerCase()) ?? null : null;
        const res = await tx.query<any>(
          `INSERT INTO accounts (company_id, code, name, name_en, name_fr, type, parent_id,
             currency, is_active, posting_allowed, account_role)
           VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT functional_currency FROM companies WHERE id=$1),true,$8,$9)
           RETURNING id`, [companyId, row.code, row.name, row.nameEn ?? row.name, row.nameFr ?? row.name,
            row.type, parentId, row.postingAllowed, row.accountRole]);
        ids.set(row.code.toLowerCase(), res.rows[0].id);
        codes.add(row.code.toLowerCase());
        created += 1;
      }
      const bytes = decode(body.contentBase64, 8 * 1024 * 1024);
      await tx.query(
        `INSERT INTO chart_profiles (company_id, template_type, status, source_name, source_sha256, imported_at, updated_at)
         VALUES ($1,'firm_chart','AWAITING FIRM CONFIRMATION',$2,$3,now(),now())
         ON CONFLICT (company_id) DO UPDATE SET template_type='firm_chart',
           status='AWAITING FIRM CONFIRMATION', source_name=$2, source_sha256=$3, imported_at=now(), updated_at=now()`,
        [companyId, body.fileName, createHash('sha256').update(bytes).digest('hex')]);
      return { created, skipped };
    });
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'chart.import.confirm',
      entityType: 'chart_profile', entityId: companyId, details: result, ip: clientIp(req) });
    return { ...result, status: 'AWAITING FIRM CONFIRMATION' };
  });

  app.post(`${base}/confirm`, async (req) => {
    const { companyId } = req.params as any;
    await requireCompany(db, req.user!.id, companyId, 'admin');
    const body = parse(z.object({ confirm: z.literal(true), note: z.string().trim().min(10).max(2000) }), req.body);
    await db.query(
      `INSERT INTO chart_profiles (company_id, template_type, status, confirmed_at, confirmed_by, notes)
       VALUES ($1,'custom_company','CONFIRMED BY FIRM',now(),$2,$3)
       ON CONFLICT (company_id) DO UPDATE SET status='CONFIRMED BY FIRM', confirmed_at=now(),
         confirmed_by=$2, notes=$3, updated_at=now()`, [companyId, req.user!.id, body.note]);
    await writeAudit(db, { companyId, userId: req.user!.id, action: 'chart.confirm',
      entityType: 'chart_profile', entityId: companyId, details: { note: body.note }, ip: clientIp(req) });
    return { profile: await profile(companyId) };
  });
}
