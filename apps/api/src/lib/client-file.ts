/**
 * Mission 44 — creation of a client file from the guided onboarding.
 *
 * `companies` remains the single client repository and the accounting engine is
 * untouched: this helper performs the very same operations as
 * `POST /companies` (ownersys membership, cabinet attachment, demonstration
 * chart and journals, first accounting period) plus the descriptive fields the
 * onboarding collects.
 */
import type { Db } from '../db/index.js';
import type { Locale } from '../i18n/index.js';
import type { CompanyRow } from '../types.js';
import { attachCompanyToCabinet } from './cabinets.js';
import { provisionCompanyDefaults } from './provisioning.js';
import { writeAudit } from './audit.js';

export interface ClientFileInput {
  name: string;
  tradeName?: string | null;
  brn?: string | null;
  crn?: string | null;
  vatNumber?: string | null;
  registeredAddress?: string | null;
  businessActivity?: string | null;
  businessDescription?: string | null;
  legalForm?: string | null;
  incorporationDate?: string | null;
  country?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  clientCode?: string | null;
  financialYearStart: string;
  financialYearEnd: string;
  functionalCurrency?: string;
  presentationCurrency?: string;
  accountingStandard?: string;
  locale?: Locale;
  withChart?: boolean;
}

const trimOrNull = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Creates the company row and its accounting defaults inside the caller's
 * transaction. The creator becomes owner and dossier manager: an onboarding
 * can never create a dossier the accountant could not open afterwards.
 */
export async function createClientFile(
  tx: Db,
  userId: string,
  input: ClientFileInput,
  options: { ip?: string | null; source?: 'onboarding' } = {},
): Promise<CompanyRow> {
  const locale: Locale = input.locale ?? 'fr';
  const created = await tx.query<CompanyRow>(
    `INSERT INTO companies
       (name, brn, vat_number, registered_address, business_activity,
        financial_year_start, financial_year_end, functional_currency,
        presentation_currency, accounting_standard, status, locale, created_by,
        crn, client_code, dossier_manager_id, trade_name, contact_name,
        contact_email, contact_phone, legal_form, incorporation_date,
        business_description, country)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      input.name.trim(),
      trimOrNull(input.brn),
      trimOrNull(input.vatNumber),
      trimOrNull(input.registeredAddress),
      trimOrNull(input.businessActivity),
      input.financialYearStart,
      input.financialYearEnd,
      input.functionalCurrency ?? 'MUR',
      input.presentationCurrency ?? input.functionalCurrency ?? 'MUR',
      input.accountingStandard ?? 'IFRS',
      'active',
      locale,
      userId,
      trimOrNull(input.crn),
      trimOrNull(input.clientCode),
      userId,
      trimOrNull(input.tradeName),
      trimOrNull(input.contactName),
      trimOrNull(input.contactEmail),
      trimOrNull(input.contactPhone),
      trimOrNull(input.legalForm),
      trimOrNull(input.incorporationDate),
      trimOrNull(input.businessDescription),
      trimOrNull(input.country),
    ],
  );
  const company = created.rows[0]!;

  await tx.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)', [
    company.id,
    userId,
    'owner',
  ]);
  await attachCompanyToCabinet(tx, company.id, userId);
  await provisionCompanyDefaults(tx, company, locale, { withChart: input.withChart !== false });
  await writeAudit(tx, {
    companyId: company.id,
    userId,
    action: options.source === 'onboarding' ? 'company.create.onboarding' : 'company.create',
    entityType: 'company',
    entityId: company.id,
    details: { name: company.name, source: options.source ?? 'direct' },
    ip: options.ip ?? null,
  });
  return company;
}
