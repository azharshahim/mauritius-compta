import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { clientIp, parse } from '../../lib/http.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import { parseIsoDate } from '../../lib/dates.js';

/**
 * Company settings (mission 7).
 *
 * One reference, one place: the same data is served to
 *   Cabinet -> Companies -> Company sheet -> Settings
 * and to
 *   Accounting -> Company settings.
 * No second table, no duplicate configuration, no copy of the company record.
 *
 * Every write is journalled in `audit_log`, and the settings of an archived
 * dossier stay read-only through `requireCompany`.
 */

const nullable = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === '' ? null : value.trim();

const identificationBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    tradeName: z.string().trim().max(200).nullable().optional(),
    brn: z.string().trim().max(60).nullable().optional(),
    vatNumber: z.string().trim().max(60).nullable().optional(),
    registeredAddress: z.string().trim().max(1000).nullable().optional(),
    businessActivity: z.string().trim().max(300).nullable().optional(),
    contactName: z.string().trim().max(120).nullable().optional(),
    contactEmail: z.string().trim().email().max(200).nullable().optional(),
    contactPhone: z.string().trim().max(60).nullable().optional(),
    locale: z.enum(['fr', 'en']).optional(),
  })
  .strict();

const accountingBody = z
  .object({
    financialYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    financialYearEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    presentationCurrency: z.string().length(3).toUpperCase().optional(),
    accountingStandard: z.string().trim().min(2).max(60).optional(),
  })
  .strict();

const billingSettingsBody = z
  .object({
    quotePrefix: z.string().trim().min(1).max(10).optional(),
    invoicePrefix: z.string().trim().min(1).max(10).optional(),
    creditPrefix: z.string().trim().min(1).max(10).optional(),
    numberingPolicy: z.enum(['yearly', 'continuous']).optional(),
    defaultPaymentTerms: z.number().int().min(0).max(365).optional(),
    documentLanguage: z.enum(['fr', 'en']).optional(),
    logoUrl: z.string().trim().max(500).nullable().optional(),
    legalFooterFr: z.string().trim().max(1000).nullable().optional(),
    legalFooterEn: z.string().trim().max(1000).nullable().optional(),
    bankDetails: z.string().trim().max(1000).nullable().optional(),
    vatEnabled: z.boolean().optional(),
    vatNumber: z.string().trim().max(60).nullable().optional(),
    defaultRevenueAccountId: z.string().uuid().nullable().optional(),
    defaultReceivableAccountId: z.string().uuid().nullable().optional(),
    defaultBankAccountId: z.string().uuid().nullable().optional(),
    defaultPurchaseAccountId: z.string().uuid().nullable().optional(),
    defaultVatInputAccountId: z.string().uuid().nullable().optional(),
    defaultVatOutputAccountId: z.string().uuid().nullable().optional(),
  })
  .strict();

export async function settingsView(db: Db, companyId: string) {
  const company = (
    await db.query<any>('SELECT * FROM companies WHERE id = $1', [companyId])
  ).rows[0];
  if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

  const [settings, accounts, journals, periods, rates, history] = await Promise.all([
    db.query<any>('SELECT * FROM billing_settings WHERE company_id = $1', [companyId]),
    db.query<any>(
      `SELECT id, code, name, type, is_active FROM accounts
        WHERE company_id = $1 ORDER BY code`,
      [companyId],
    ),
    db.query<any>(
      `SELECT id, code, name, type, is_active FROM journals
        WHERE company_id = $1 ORDER BY code`,
      [companyId],
    ),
    db.query<any>(
      `SELECT id, name, start_date::text, end_date::text, status FROM accounting_periods
        WHERE company_id = $1 ORDER BY start_date DESC`,
      [companyId],
    ),
    db.query<any>(
      `SELECT id, code, label, rate, treatment, effective_from::text, effective_to::text,
              verified, verified_at, verified_by, source, notes, vat_account_id
         FROM billing_tax_rates WHERE company_id = $1
        ORDER BY effective_from DESC, code`,
      [companyId],
    ),
    db.query<any>(
      `SELECT id, action, user_id, details, created_at
         FROM audit_log
        WHERE company_id = $1 AND action LIKE ANY (ARRAY['settings.%','billing.settings.%','billing.tax_rate.%'])
        ORDER BY created_at DESC LIMIT 50`,
      [companyId],
    ),
  ]);

  const s = settings.rows[0] ?? null;
  const verified = rates.rows.filter((r) => r.verified).length;

  return {
    company: {
      id: company.id,
      status: company.status,
      locale: company.locale,
      createdAt: company.created_at,
      updatedAt: company.updated_at,
    },
    identification: {
      name: company.name,
      tradeName: company.trade_name,
      brn: company.brn,
      vatNumber: company.vat_number,
      registeredAddress: company.registered_address,
      businessActivity: company.business_activity,
      contactName: company.contact_name,
      contactEmail: company.contact_email,
      contactPhone: company.contact_phone,
      locale: company.locale,
    },
    accounting: {
      functionalCurrency: company.functional_currency,
      presentationCurrency: company.presentation_currency,
      accountingStandard: company.accounting_standard,
      financialYearStart: company.financial_year_start,
      financialYearEnd: company.financial_year_end,
      journals: journals.rows,
      periods: periods.rows,
      defaultAccounts: s
        ? {
            revenue: s.default_revenue_account_id,
            receivable: s.default_receivable_account_id,
            bank: s.default_bank_account_id,
            purchase: s.default_purchase_account_id,
            vatInput: s.default_vat_input_account_id,
            vatOutput: s.default_vat_output_account_id,
          }
        : null,
    },
    billing: s
      ? {
          quotePrefix: s.quote_prefix,
          invoicePrefix: s.invoice_prefix,
          creditPrefix: s.credit_prefix,
          numberingPolicy: s.numbering_policy,
          defaultPaymentTerms: s.default_payment_terms,
          defaultCurrency: s.default_currency,
          documentLanguage: s.document_language,
          logoUrl: s.logo_url,
          legalFooterFr: s.legal_footer_fr,
          legalFooterEn: s.legal_footer_en,
          bankDetails: s.bank_details,
          defaultRevenueAccountId: s.default_revenue_account_id,
          defaultReceivableAccountId: s.default_receivable_account_id,
          defaultBankAccountId: s.default_bank_account_id,
          defaultPurchaseAccountId: s.default_purchase_account_id,
          defaultVatInputAccountId: s.default_vat_input_account_id,
          defaultVatOutputAccountId: s.default_vat_output_account_id,
          updatedAt: s.updated_at,
        }
      : null,
    tax: {
      vatEnabled: s?.vat_enabled ?? false,
      vatNumber: s?.vat_number ?? company.vat_number,
      rates: rates.rows.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        rate: r.rate,
        treatment: r.treatment,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        verified: r.verified,
        verifiedAt: r.verified_at,
        verifiedBy: r.verified_by,
        source: r.source,
        notes: r.notes,
        vatAccountId: r.vat_account_id,
      })),
      verifiedCount: verified,
      unverifiedCount: rates.rows.length - verified,
      notice:
        'Aucun taux n’est prérempli. Un taux non vérifié ne peut pas servir à émettre une facture fiscale ; le statut « vérifié » exige une source documentée et une validation humaine.',
    },
    chartOfAccounts: accounts.rows,
    history: history.rows.map((h) => ({
      id: h.id,
      action: h.action,
      userId: h.user_id,
      details: h.details,
      createdAt: h.created_at,
    })),
  };
}

async function assertAccount(db: Db, companyId: string, accountId: string | null | undefined) {
  if (!accountId) return null;
  const res = await db.query('SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2', [
    accountId,
    companyId,
  ]);
  if (res.rowCount === 0) {
    throw badRequest(
      'SETTINGS_ACCOUNT_NOT_IN_CHART',
      'The selected account does not belong to this company chart of accounts',
    );
  }
  return accountId;
}

export async function companySettingsRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/companies/:companyId/settings/company', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'viewer', 'cabinet');
    const view = await settingsView(db, companyId);
    const role = ctx.role;
    const canEdit = role === 'owner' || role === 'admin';
    return {
      ...view,
      permissions: {
        canEditIdentification: canEdit,
        canEditAccounting: canEdit,
        canEditBilling: canEdit,
        canEditTax: canEdit,
      },
    };
  });

  app.patch('/companies/:companyId/settings/identification', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'cabinet');
    const body = parse(identificationBody, req.body);

    const before = (await db.query<any>('SELECT * FROM companies WHERE id = $1', [companyId]))
      .rows[0];
    if (!before) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

    const updated = await db.query<any>(
      `UPDATE companies SET
         name = COALESCE($2, name),
         trade_name = $3,
         brn = $4,
         vat_number = $5,
         registered_address = $6,
         business_activity = $7,
         contact_name = $8,
         contact_email = $9,
         contact_phone = $10,
         locale = COALESCE($11, locale),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        companyId,
        body.name ?? null,
        body.tradeName === undefined ? before.trade_name : nullable(body.tradeName),
        body.brn === undefined ? before.brn : nullable(body.brn),
        body.vatNumber === undefined ? before.vat_number : nullable(body.vatNumber),
        body.registeredAddress === undefined ? before.registered_address : nullable(body.registeredAddress),
        body.businessActivity === undefined ? before.business_activity : nullable(body.businessActivity),
        body.contactName === undefined ? before.contact_name : nullable(body.contactName),
        body.contactEmail === undefined ? before.contact_email : nullable(body.contactEmail),
        body.contactPhone === undefined ? before.contact_phone : nullable(body.contactPhone),
        body.locale ?? null,
      ],
    );

    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'settings.identification.update',
      entityType: 'company',
      entityId: companyId,
      details: {
        changed: Object.keys(body),
        before: { name: before.name, brn: before.brn, vatNumber: before.vat_number },
        after: { name: updated.rows[0].name, brn: updated.rows[0].brn, vatNumber: updated.rows[0].vat_number },
      },
      ip: clientIp(req),
    });

    return { identification: (await settingsView(db, companyId)).identification };
  });

  app.patch('/companies/:companyId/settings/accounting', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'accounting');
    const body = parse(accountingBody, req.body);

    const company = (await db.query<any>('SELECT * FROM companies WHERE id = $1', [companyId]))
      .rows[0];
    if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

    const start = body.financialYearStart
      ? parseIsoDate(body.financialYearStart, 'financialYearStart')
      : company.financial_year_start;
    const end = body.financialYearEnd
      ? parseIsoDate(body.financialYearEnd, 'financialYearEnd')
      : company.financial_year_end;
    if (start >= end) throw badRequest('VALIDATION_ERROR', 'The financial year end must follow its start');

    if (body.financialYearStart || body.financialYearEnd) {
      // A change that would orphan a posted entry is refused: accounting history
      // is never silently pushed outside the declared financial year.
      const outside = await db.query(
        `SELECT 1 FROM journal_entries
          WHERE company_id = $1 AND status = 'posted' AND (entry_date < $2 OR entry_date > $3)
          LIMIT 1`,
        [companyId, start, end],
      );
      if (outside.rowCount && outside.rowCount > 0) {
        throw conflict(
          'SETTINGS_FINANCIAL_YEAR_LOCKED',
          'Posted entries exist outside the requested financial year: the change is refused',
        );
      }
    }

    if (body.presentationCurrency && body.presentationCurrency !== company.presentation_currency) {
      const journals = await db.query('SELECT 1 FROM journals WHERE company_id = $1 LIMIT 1', [companyId]);
      if (journals.rowCount && journals.rowCount > 0) {
        throw conflict(
          'SETTINGS_CURRENCY_LOCKED',
          'The presentation currency cannot be changed once the chart of accounts is created',
        );
      }
    }

    await db.query(
      `UPDATE companies SET
         financial_year_start = $2,
         financial_year_end = $3,
         presentation_currency = COALESCE($4, presentation_currency),
         accounting_standard = COALESCE($5, accounting_standard),
         updated_at = now()
       WHERE id = $1`,
      [
        companyId,
        start,
        end,
        body.presentationCurrency ?? null,
        body.accountingStandard ?? null,
      ],
    );

    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'settings.accounting.update',
      entityType: 'company',
      entityId: companyId,
      details: {
        changed: Object.keys(body),
        financialYearStart: start,
        financialYearEnd: end,
      },
      ip: clientIp(req),
    });

    return { accounting: (await settingsView(db, companyId)).accounting };
  });

  app.patch('/companies/:companyId/settings/billing', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'billing');
    const body = parse(billingSettingsBody, req.body);

    for (const key of [
      'defaultRevenueAccountId',
      'defaultReceivableAccountId',
      'defaultBankAccountId',
      'defaultPurchaseAccountId',
      'defaultVatInputAccountId',
      'defaultVatOutputAccountId',
    ] as const) {
      await assertAccount(db, companyId, body[key]);
    }

    await db.query('INSERT INTO billing_settings (company_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      companyId,
    ]);
    // Only the fields actually sent are written: a partial PATCH never clears
    // an existing configuration by accident.
    const columns: Record<string, string> = {
      quotePrefix: 'quote_prefix',
      invoicePrefix: 'invoice_prefix',
      creditPrefix: 'credit_prefix',
      numberingPolicy: 'numbering_policy',
      defaultPaymentTerms: 'default_payment_terms',
      documentLanguage: 'document_language',
      logoUrl: 'logo_url',
      legalFooterFr: 'legal_footer_fr',
      legalFooterEn: 'legal_footer_en',
      bankDetails: 'bank_details',
      vatEnabled: 'vat_enabled',
      vatNumber: 'vat_number',
      defaultRevenueAccountId: 'default_revenue_account_id',
      defaultReceivableAccountId: 'default_receivable_account_id',
      defaultBankAccountId: 'default_bank_account_id',
      defaultPurchaseAccountId: 'default_purchase_account_id',
      defaultVatInputAccountId: 'default_vat_input_account_id',
      defaultVatOutputAccountId: 'default_vat_output_account_id',
    };
    const sets: string[] = [];
    const params: unknown[] = [companyId];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in body)) continue;
      const raw = (body as Record<string, unknown>)[key];
      params.push(
        typeof raw === 'string' && key !== 'numberingPolicy' && key !== 'documentLanguage'
          ? nullable(raw)
          : raw ?? null,
      );
      sets.push(`${column} = $${params.length}`);
    }
    sets.push(`updated_by = $${params.push(user.id)}`, 'updated_at = now()');

    const updated = await db.query<any>(
      `UPDATE billing_settings SET ${sets.join(', ')} WHERE company_id = $1 RETURNING *`,
      params,
    );

    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'settings.billing.update',
      entityType: 'billing_settings',
      entityId: companyId,
      details: { changed: Object.keys(body) },
      ip: clientIp(req),
    });

    void (updated.rows[0] as unknown);
    return { billing: (await settingsView(db, companyId)).billing };
  });
}

export type { FastifyRequest };
