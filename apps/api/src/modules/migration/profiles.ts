import { normalizeHeader } from './normalize.js';

/**
 * Source profiles and target field catalogues of the migration assistant.
 *
 * A profile is a *tested* set of header aliases. `excel`, `csv` and `other`
 * are declared **supported**: they rely on the generic FR/EN aliases and are
 * covered by the automated fixtures. The Sage and SAP profiles are declared
 * **experimental**: they are modelled on published export layouts and covered
 * only by explicitly fictional sample files. No certification, no direct
 * connection to Sage or SAP, and no "universal" compatibility claim is made.
 */

export const IMPORT_KINDS = [
  'chart_of_accounts',
  'opening_balance',
  'journal_entries',
  'customers',
  'companies',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const SOURCES = ['excel', 'csv', 'sage50', 'sage200', 'sage_accounting', 'sap', 'other'] as const;
export type MigrationSource = (typeof SOURCES)[number];

export type FieldType =
  | 'text'
  | 'amount'
  | 'date'
  | 'accountType'
  | 'currency'
  | 'rate'
  | 'indicator'
  | 'integer'
  | 'boolean';

export interface FieldDef {
  key: string;
  labelFr: string;
  labelEn: string;
  required: boolean;
  type: FieldType;
  maxLength?: number;
  aliases: string[];
}

const ACCOUNT_ALIASES = [
  'code',
  'code du compte',
  'compte',
  'code compte',
  'code de compte',
  'numero de compte',
  'no compte',
  'n compte',
  'num compte',
  'compte general',
  'compte gl',
  "plan comptable",
  'account',
  'account code',
  'account number',
  'gl account',
  'g l account',
  'generalledgeraccount',
  'konto',
];

const AMOUNT_ALIASES = ['montant', 'amount', 'valeur', 'somme', 'total', 'montant en devise'];
const DEBIT_ALIASES = ['debit', 'debit amount', 'montant debit', 'debit mur', 'debits', 'dr', 'soll', 'debit in local currency'];
const CREDIT_ALIASES = ['credit', 'credit amount', 'montant credit', 'credit mur', 'credits', 'cr', 'haben', 'credit in local currency'];
const DATE_ALIASES = [
  'date',
  'date ecriture',
  'date comptable',
  'date de comptabilisation',
  'date operation',
  'date piece',
  'posting date',
  'document date',
  'entry date',
  'transaction date',
  'budat',
];
const DESCRIPTION_ALIASES = [
  'libelle',
  'libelle ecriture',
  'intitule',
  'designation',
  'description',
  'texte',
  'memo',
  'narration',
  'label',
  'name',
  'nom',
  'account name',
  'intitule du compte',
];
const JOURNAL_ALIASES = ['journal', 'code journal', 'journal code', 'type journal', 'journal type', 'jrnl'];
const CURRENCY_ALIASES = ['devise', 'currency', 'monnaie', 'waers', 'devise document', 'document currency'];
const RATE_ALIASES = ['taux', 'taux de change', 'exchange rate', 'cours', 'fx rate', 'rate'];
const REFERENCE_ALIASES = [
  'reference',
  'ref',
  'piece',
  'numero de piece',
  'no piece',
  'n piece',
  'document number',
  'doc no',
  'document no',
  'voucher',
  'voucher number',
  'belnr',
  'invoice number',
];
const ENTRY_KEY_ALIASES = [
  ...REFERENCE_ALIASES,
  'ecriture',
  'numero ecriture',
  'entry',
  'entry id',
  'entry no',
  'group',
  'groupe',
  'lot',
  'document',
  'doc id',
  'piece comptable',
];

/** Catalogue per import kind. Field order drives the wizard's mapping table. */
export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  chart_of_accounts: [
    { key: 'code', labelFr: 'Code compte', labelEn: 'Account code', required: true, type: 'text', maxLength: 32, aliases: ACCOUNT_ALIASES },
    { key: 'name', labelFr: 'Intitulé', labelEn: 'Account name', required: true, type: 'text', maxLength: 160, aliases: DESCRIPTION_ALIASES },
    { key: 'type', labelFr: 'Type (actif, passif…)', labelEn: 'Type (asset, liability…)', required: false, type: 'accountType', aliases: ['type', 'type de compte', 'nature', 'account type', 'account class', 'classe'] },
    { key: 'currency', labelFr: 'Devise', labelEn: 'Currency', required: false, type: 'currency', aliases: CURRENCY_ALIASES },
    { key: 'isActive', labelFr: 'Actif (oui/non)', labelEn: 'Active (yes/no)', required: false, type: 'boolean', aliases: ['actif', 'active', 'is active', 'statut', 'status', 'enabled'] },
    { key: 'description', labelFr: 'Description', labelEn: 'Description', required: false, type: 'text', maxLength: 400, aliases: ['commentaire', 'note', 'notes', 'remarque', 'memo'] },
  ],
  opening_balance: [
    { key: 'accountCode', labelFr: 'Compte', labelEn: 'Account', required: true, type: 'text', maxLength: 32, aliases: ACCOUNT_ALIASES },
    { key: 'debit', labelFr: 'Débit', labelEn: 'Debit', required: false, type: 'amount', aliases: DEBIT_ALIASES },
    { key: 'credit', labelFr: 'Crédit', labelEn: 'Credit', required: false, type: 'amount', aliases: CREDIT_ALIASES },
    { key: 'description', labelFr: 'Libellé de ligne', labelEn: 'Line label', required: false, type: 'text', maxLength: 240, aliases: ['libelle', 'libelle ligne', 'label', 'description', 'memo'] },
  ],
  journal_entries: [
    { key: 'entryKey', labelFr: "N° de pièce (regroupe les lignes)", labelEn: 'Document number (groups lines)', required: true, type: 'text', maxLength: 80, aliases: ENTRY_KEY_ALIASES },
    { key: 'entryDate', labelFr: "Date d'écriture", labelEn: 'Posting date', required: true, type: 'date', aliases: DATE_ALIASES },
    { key: 'accountCode', labelFr: 'Compte', labelEn: 'Account', required: true, type: 'text', maxLength: 32, aliases: ACCOUNT_ALIASES },
    { key: 'journalCode', labelFr: 'Journal', labelEn: 'Journal', required: false, type: 'text', maxLength: 16, aliases: JOURNAL_ALIASES },
    { key: 'description', labelFr: 'Libellé', labelEn: 'Description', required: false, type: 'text', maxLength: 240, aliases: DESCRIPTION_ALIASES },
    { key: 'debit', labelFr: 'Débit', labelEn: 'Debit', required: false, type: 'amount', aliases: DEBIT_ALIASES },
    { key: 'credit', labelFr: 'Crédit', labelEn: 'Credit', required: false, type: 'amount', aliases: CREDIT_ALIASES },
    { key: 'amount', labelFr: 'Montant signé (alternative)', labelEn: 'Signed amount (alternative)', required: false, type: 'amount', aliases: AMOUNT_ALIASES },
    { key: 'dcIndicator', labelFr: 'Sens débit/crédit', labelEn: 'Debit/credit indicator', required: false, type: 'indicator', aliases: ['sens', 'indicateur debit credit', 'debit credit indicator', 'debit credit', 'shkzg', 'dc', 'd c', 'dr cr', 'side'] },
    { key: 'currency', labelFr: 'Devise', labelEn: 'Currency', required: false, type: 'currency', aliases: CURRENCY_ALIASES },
    { key: 'exchangeRate', labelFr: 'Taux de change', labelEn: 'Exchange rate', required: false, type: 'rate', aliases: RATE_ALIASES },
    { key: 'reference', labelFr: 'Référence de pièce', labelEn: 'Document reference', required: false, type: 'text', maxLength: 80, aliases: REFERENCE_ALIASES },
  ],
  customers: [
    { key: 'name', labelFr: 'Nom du client', labelEn: 'Customer name', required: true, type: 'text', maxLength: 160, aliases: ['nom', 'client', 'nom du client', 'raison sociale', 'name', 'customer', 'customer name', 'account name', 'denomination'] },
    { key: 'legalName', labelFr: 'Raison sociale complète', labelEn: 'Legal name', required: false, type: 'text', maxLength: 160, aliases: ['raison sociale', 'legal name', 'company name'] },
    { key: 'brn', labelFr: 'BRN', labelEn: 'BRN', required: false, type: 'text', maxLength: 32, aliases: ['brn', 'business registration number', 'numero brn', 'registration number', 'no brn'] },
    { key: 'vatNumber', labelFr: 'N° TVA', labelEn: 'VAT number', required: false, type: 'text', maxLength: 32, aliases: ['tva', 'vat', 'vat number', 'numero tva', 'no tva', 'tax id', 'vrn'] },
    { key: 'email', labelFr: 'Courriel', labelEn: 'Email', required: false, type: 'text', maxLength: 160, aliases: ['email', 'courriel', 'mail', 'e mail', 'contact email'] },
    { key: 'phone', labelFr: 'Téléphone', labelEn: 'Phone', required: false, type: 'text', maxLength: 40, aliases: ['telephone', 'tel', 'phone', 'mobile', 'contact phone'] },
    { key: 'addressLine1', labelFr: 'Adresse', labelEn: 'Address', required: false, type: 'text', maxLength: 160, aliases: ['adresse', 'address', 'address line 1', 'adresse ligne 1', 'rue'] },
    { key: 'city', labelFr: 'Ville', labelEn: 'City', required: false, type: 'text', maxLength: 80, aliases: ['ville', 'city', 'localite', 'town'] },
    { key: 'postcode', labelFr: 'Code postal', labelEn: 'Postcode', required: false, type: 'text', maxLength: 20, aliases: ['code postal', 'postcode', 'zip', 'postal code'] },
    { key: 'country', labelFr: 'Pays', labelEn: 'Country', required: false, type: 'text', maxLength: 2, aliases: ['pays', 'country', 'iso pays'] },
    { key: 'paymentTermsDays', labelFr: 'Délai de paiement (jours)', labelEn: 'Payment terms (days)', required: false, type: 'integer', aliases: ['delai de paiement', 'payment terms', 'terms', 'echeance jours', 'payment terms days'] },
  ],
  companies: [
    { key: 'name', labelFr: 'Nom de la société', labelEn: 'Company name', required: true, type: 'text', maxLength: 160, aliases: ['nom', 'societe', 'nom de la societe', 'name', 'company', 'company name', 'entite'] },
    { key: 'brn', labelFr: 'BRN', labelEn: 'BRN', required: false, type: 'text', maxLength: 32, aliases: ['brn', 'business registration number', 'numero brn'] },
    { key: 'crn', labelFr: 'CRN', labelEn: 'CRN', required: false, type: 'text', maxLength: 32, aliases: ['crn', 'company registration number', 'numero crn'] },
    { key: 'vatNumber', labelFr: 'N° TVA', labelEn: 'VAT number', required: false, type: 'text', maxLength: 32, aliases: ['tva', 'vat', 'vat number', 'numero tva', 'vrn'] },
    { key: 'currency', labelFr: 'Devise fonctionnelle', labelEn: 'Functional currency', required: false, type: 'currency', aliases: ['devise', 'currency', 'devise fonctionnelle', 'functional currency'] },
    { key: 'financialYearStart', labelFr: 'Début exercice', labelEn: 'Financial year start', required: false, type: 'date', aliases: ['debut exercice', 'exercice debut', 'financial year start', 'fy start', 'date debut'] },
    { key: 'financialYearEnd', labelFr: 'Fin exercice', labelEn: 'Financial year end', required: false, type: 'date', aliases: ['fin exercice', 'exercice fin', 'financial year end', 'fy end', 'date fin'] },
    { key: 'registeredAddress', labelFr: 'Adresse', labelEn: 'Registered address', required: false, type: 'text', maxLength: 240, aliases: ['adresse', 'address', 'registered address'] },
    { key: 'businessActivity', labelFr: 'Activité', labelEn: 'Business activity', required: false, type: 'text', maxLength: 240, aliases: ['activite', 'activity', 'business activity', 'secteur'] },
  ],
};

export interface ProfileDef {
  key: string;
  source: MigrationSource;
  labelFr: string;
  labelEn: string;
  /** `supported` = covered by automated tests on documented formats. */
  status: 'supported' | 'experimental';
  kinds: ImportKind[];
  notesFr: string;
  notesEn: string;
  /** Extra header aliases specific to the source. */
  extraAliases?: Record<string, string[]>;
}

export const PROFILES: ProfileDef[] = [
  {
    key: 'generic_excel',
    source: 'excel',
    labelFr: 'Excel générique (.xlsx)',
    labelEn: 'Generic Excel (.xlsx)',
    status: 'supported',
    kinds: [...IMPORT_KINDS],
    notesFr: 'Lecture directe des feuilles, aucune macro ni formule exécutée.',
    notesEn: 'Sheets are read directly; no macro or formula is ever executed.',
  },
  {
    key: 'generic_csv',
    source: 'csv',
    labelFr: 'CSV / TSV générique',
    labelEn: 'Generic CSV / TSV',
    status: 'supported',
    kinds: [...IMPORT_KINDS],
    notesFr: 'Délimiteurs , ; tabulation ; UTF-8, UTF-16 et Windows-1252 ; montants et dates FR/EN.',
    notesEn: 'Delimiters , ; tab ; UTF-8, UTF-16 and Windows-1252; FR/EN amounts and dates.',
  },
  {
    key: 'sage50',
    source: 'sage50',
    labelFr: 'Sage 50 — export comptable',
    labelEn: 'Sage 50 — accounting export',
    status: 'experimental',
    kinds: ['chart_of_accounts', 'opening_balance', 'journal_entries', 'customers'],
    notesFr: "Profil expérimental fondé sur les en-têtes d'usage (Compte, Libellé, Débit, Crédit, Journal, Pièce). Non certifié Sage, testé uniquement avec des fichiers fictifs.",
    notesEn: 'Experimental profile based on documented header names (Account, Name, Debit, Credit, Journal, Document). Not Sage-certified; tested with fictional files only.',
    extraAliases: {
      code: ['compte', 'n compte'],
      name: ['intitule du compte', 'libelle du compte'],
      entryKey: ['piece', 'n piece', 'numero de piece'],
      reference: ['piece', 'reference piece'],
      journalCode: ['code journal', 'journal'],
    },
  },
  {
    key: 'sage200',
    source: 'sage200',
    labelFr: 'Sage 200 — export grand livre',
    labelEn: 'Sage 200 — nominal ledger export',
    status: 'experimental',
    kinds: ['chart_of_accounts', 'opening_balance', 'journal_entries'],
    notesFr: 'Profil expérimental (Nominal Code, Nominal Name, Debit, Credit, Posting Date, Transaction Reference). Non certifié Sage.',
    notesEn: 'Experimental profile (Nominal Code, Nominal Name, Debit, Credit, Posting Date, Transaction Reference). Not Sage-certified.',
    extraAliases: {
      code: ['nominal code', 'nl code'],
      accountCode: ['nominal code', 'nl code'],
      name: ['nominal name', 'nominal account name'],
      entryKey: ['transaction reference', 'transaction no', 'urn'],
      entryDate: ['posting date', 'transaction date'],
    },
  },
  {
    key: 'sage_accounting',
    source: 'sage_accounting',
    labelFr: 'Sage Accounting — export CSV',
    labelEn: 'Sage Accounting — CSV export',
    status: 'experimental',
    kinds: ['chart_of_accounts', 'journal_entries', 'customers'],
    notesFr: 'Profil expérimental (Account Code, Account Name, Date, Reference, Debit, Credit, Currency). Non certifié Sage.',
    notesEn: 'Experimental profile (Account Code, Account Name, Date, Reference, Debit, Credit, Currency). Not Sage-certified.',
    extraAliases: {
      code: ['account code'],
      accountCode: ['account code', 'ledger account'],
      name: ['account name', 'ledger account name'],
      entryKey: ['reference', 'transaction reference'],
    },
  },
  {
    key: 'sap',
    source: 'sap',
    labelFr: 'SAP — export grand livre / pièces',
    labelEn: 'SAP — G/L and journal export',
    status: 'experimental',
    kinds: ['chart_of_accounts', 'opening_balance', 'journal_entries'],
    notesFr: "Profil expérimental (Company Code, G/L Account, Posting Date, Document Date, Document Number, Debit/Credit Indicator, Amount, Currency, Cost Center). Aucune connexion SAP, aucun RFC/BAPI, compatibilité non universelle.",
    notesEn: 'Experimental profile (Company Code, G/L Account, Posting Date, Document Date, Document Number, Debit/Credit Indicator, Amount, Currency, Cost Center). No SAP connection, no RFC/BAPI, no universal compatibility claim.',
    extraAliases: {
      accountCode: ['g l account', 'gl account', 'saknr', 'general ledger account'],
      code: ['g l account', 'gl account', 'saknr'],
      entryKey: ['document number', 'accounting document', 'belnr', 'doc no'],
      entryDate: ['posting date', 'budat'],
      amount: ['amount in document currency', 'amount in local currency', 'wrbtr', 'dmbtr', 'amount'],
      dcIndicator: ['debit credit indicator', 'shkzg', 'debit credit'],
      currency: ['currency', 'waers', 'document currency'],
      description: ['document type', 'item text', 'sgtxt', 'text'],
    },
  },
  {
    key: 'other',
    source: 'other',
    labelFr: 'Autre logiciel / fichier maison',
    labelEn: 'Other software / in-house file',
    status: 'supported',
    kinds: [...IMPORT_KINDS],
    notesFr: 'Correspondance manuelle des colonnes ; les contrôles restent obligatoires.',
    notesEn: 'Manual column mapping; mandatory controls still apply.',
  },
];

export function profileBySource(source: MigrationSource): ProfileDef[] {
  return PROFILES.filter((p) => p.source === source);
}

export function profileByKey(key: string): ProfileDef | undefined {
  return PROFILES.find((p) => p.key === key);
}

export function fieldsForKind(kind: ImportKind): FieldDef[] {
  return IMPORT_FIELDS[kind];
}

export function requiredFields(kind: ImportKind): FieldDef[] {
  return IMPORT_FIELDS[kind].filter((f) => f.required);
}

/* -------------------------------------------------------------------------- */
/* Suggestion                                                                 */
/* -------------------------------------------------------------------------- */

export interface ColumnSuggestion {
  field: string;
  column: string | null;
  confidence: number;
  candidates: { column: string; confidence: number }[];
}

function scoreHeader(header: string, aliases: string[]): number {
  const normalized = normalizeHeader(header);
  if (!normalized) return 0;
  let best = 0;
  aliases.forEach((alias, index) => {
    const key = normalizeHeader(alias);
    if (!key) return;
    let score = 0;
    if (normalized === key) score = 1;
    else if (normalized.startsWith(`${key} `)) score = 0.85;
    else if (normalized.endsWith(` ${key}`)) score = 0.8;
    else if (normalized.includes(key)) score = 0.68;
    else if (key.includes(normalized) && normalized.length >= 4) score = 0.5;
    // The order of the aliases encodes their relevance: "Intitulé" (name)
    // wins over the generic "Description" for the account name field.
    if (score > 0) score -= Math.min(index, 40) * 0.002;
    if (score > best) best = score;
  });
  return best;
}

/** A debit/credit *indicator* must never be read as a debit or credit column. */
function isIndicatorHeader(header: string): boolean {
  return /debit.*credit|credit.*debit|indicator|shkzg|sens\b/.test(normalizeHeader(header));
}

/**
 * Deterministic header detection. No AI, no fuzzy black box: every suggestion
 * exposes the score of each candidate so the UI can show why it was chosen and
 * the user always keeps the final word.
 */
export function suggestMapping(
  headers: string[],
  kind: ImportKind,
  profileKey?: string | null,
): Record<string, ColumnSuggestion> {
  const profile = profileKey ? profileByKey(profileKey) : undefined;
  const result: Record<string, ColumnSuggestion> = {};
  const claimed = new Set<string>();

  for (const field of fieldsForKind(kind)) {
    const aliases = [...field.aliases, ...(profile?.extraAliases?.[field.key] ?? [])];
    const scored = headers
      .filter(
        (column) =>
          !((field.key === 'debit' || field.key === 'credit') && isIndicatorHeader(column)),
      )
      .map((column) => ({ column, confidence: scoreHeader(column, aliases) }))
      .filter((c) => c.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence || a.column.localeCompare(b.column));
    const free = scored.filter((c) => !claimed.has(c.column));
    const pick = free[0] ?? scored[0] ?? null;
    if (pick) claimed.add(pick.column);
    result[field.key] = {
      field: field.key,
      column: pick && pick.confidence >= 0.55 ? pick.column : null,
      confidence: pick && pick.confidence >= 0.55 ? pick.confidence : 0,
      candidates: scored.slice(0, 4),
    };
  }
  return result;
}

export function autoMapping(suggestions: Record<string, ColumnSuggestion>): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const [field, suggestion] of Object.entries(suggestions)) {
    if (suggestion.column) mapping[field] = suggestion.column;
  }
  return mapping;
}

export const IMPORT_KIND_LABELS: Record<ImportKind, { fr: string; en: string }> = {
  chart_of_accounts: { fr: 'Plan comptable', en: 'Chart of accounts' },
  opening_balance: { fr: "Balance d'ouverture", en: 'Opening balance' },
  journal_entries: { fr: 'Écritures comptables', en: 'Journal entries' },
  customers: { fr: 'Clients', en: 'Customers' },
  companies: { fr: 'Sociétés (cabinet)', en: 'Companies (firm)' },
};
