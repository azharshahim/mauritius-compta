import { normalizeHeader } from '../migration/normalize.js';
import { isIndicatorHeader, scoreHeader } from '../migration/profiles.js';

/**
 * Bank statement field catalogue and deterministic header detection.
 *
 * It builds on the mission-8 parser and scoring (bounded word score, alias
 * order) instead of a second fragile implementation. A debit/credit
 * *indicator* is never taken for a debit/credit amount column.
 */

export type BankFieldType = 'date' | 'text' | 'amount' | 'currency' | 'indicator';

export type BankFieldKey =
  | 'txnDate'
  | 'valueDate'
  | 'label'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'currency'
  | 'balance'
  | 'externalId'
  | 'direction';

export interface BankFieldDef {
  key: BankFieldKey;
  labelFr: string;
  labelEn: string;
  required: boolean;
  type: BankFieldType;
  aliases: string[];
}

export const BANK_FIELDS: BankFieldDef[] = [
  {
    key: 'txnDate',
    labelFr: 'Date d’opération',
    labelEn: 'Transaction date',
    required: true,
    type: 'date',
    aliases: [
      'date operation',
      'date d operation',
      'date de l operation',
      'date',
      'operation date',
      'transaction date',
      'posting date',
      'date comptable',
    ],
  },
  {
    key: 'valueDate',
    labelFr: 'Date de valeur',
    labelEn: 'Value date',
    required: false,
    type: 'date',
    aliases: ['date valeur', 'valeur', 'value date', 'valeur comptable'],
  },
  {
    key: 'label',
    labelFr: 'Libellé',
    labelEn: 'Description',
    required: true,
    type: 'text',
    aliases: [
      'libelle',
      'libelle operation',
      'libelle de l operation',
      'description',
      'details',
      'narration',
      'memo',
      'memory',
      'transaction',
      'nature',
      'label',
    ],
  },
  {
    key: 'reference',
    labelFr: 'Référence',
    labelEn: 'Reference',
    required: false,
    type: 'text',
    aliases: [
      'reference',
      'ref',
      'reference operation',
      'no operation',
      'numero operation',
      'transaction reference',
      'cheque',
      'cheque no',
      'piece',
    ],
  },
  {
    key: 'debit',
    labelFr: 'Débit (sortie)',
    labelEn: 'Debit (money out)',
    required: false,
    type: 'amount',
    aliases: [
      'debit',
      'debit amount',
      'montant debit',
      'sortie',
      'sorties',
      'withdrawal',
      'withdrawals',
      'paid out',
      'payments out',
      'retrait',
      'retraits',
      'out',
    ],
  },
  {
    key: 'credit',
    labelFr: 'Crédit (entrée)',
    labelEn: 'Credit (money in)',
    required: false,
    type: 'amount',
    aliases: [
      'credit',
      'credit amount',
      'montant credit',
      'entree',
      'entrees',
      'deposit',
      'deposits',
      'paid in',
      'payments in',
      'versement',
      'versements',
      'in',
    ],
  },
  {
    key: 'amount',
    labelFr: 'Montant signé',
    labelEn: 'Signed amount',
    required: false,
    type: 'amount',
    aliases: ['montant', 'amount', 'montant signe', 'signed amount', 'valeur', 'somme'],
  },
  {
    key: 'currency',
    labelFr: 'Devise',
    labelEn: 'Currency',
    required: false,
    type: 'currency',
    aliases: ['devise', 'currency', 'monnaie', 'ccy', 'currency code', 'waers'],
  },
  {
    key: 'balance',
    labelFr: 'Solde après opération',
    labelEn: 'Running balance',
    required: false,
    type: 'amount',
    aliases: ['solde', 'balance', 'solde apres operation', 'running balance', 'solde progressif', 'nouveau solde'],
  },
  {
    key: 'externalId',
    labelFr: 'Identifiant de transaction',
    labelEn: 'Transaction identifier',
    required: false,
    type: 'text',
    aliases: [
      'id transaction',
      'transaction id',
      'identifiant transaction',
      'identifiant operation',
      'txn id',
      'txid',
      'reference unique',
      'unique reference',
      'fitid',
    ],
  },
  {
    key: 'direction',
    labelFr: 'Sens débit/crédit',
    labelEn: 'Debit/credit indicator',
    required: false,
    type: 'indicator',
    aliases: ['sens', 'debit credit', 'dc', 'd c', 'indicator', 'signe', 'direction', 'dr cr'],
  },
];

export interface BankColumnSuggestion {
  field: BankFieldKey;
  column: string | null;
  confidence: number;
  candidates: { column: string; confidence: number }[];
}

export function suggestBankMapping(headers: string[]): Record<BankFieldKey, BankColumnSuggestion> {
  const result = {} as Record<BankFieldKey, BankColumnSuggestion>;
  const claimed = new Set<string>();
  for (const field of BANK_FIELDS) {
    const indicator = field.key === 'direction';
    const scored = headers
      .filter((column) => !(indicator && !isIndicatorHeader(column)))
      .filter(
        (column) =>
          !((field.key === 'debit' || field.key === 'credit') && isIndicatorHeader(column)),
      )
      .map((column) => ({ column, confidence: scoreHeader(column, field.aliases) }))
      .filter((c) => c.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence || a.column.localeCompare(b.column));
    const free = scored.filter((c) => !claimed.has(c.column));
    const pick = free[0] ?? scored[0] ?? null;
    if (pick && pick.confidence >= 0.6) claimed.add(pick.column);
    result[field.key] = {
      field: field.key,
      column: pick && pick.confidence >= 0.6 ? pick.column : null,
      confidence: pick && pick.confidence >= 0.6 ? pick.confidence : 0,
      candidates: scored.slice(0, 4),
    };
  }
  return result;
}

export function autoBankMapping(
  suggestions: Record<BankFieldKey, BankColumnSuggestion>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of BANK_FIELDS) {
    const suggestion = suggestions[field.key];
    if (suggestion?.column) mapping[field.key] = suggestion.column;
  }
  return mapping;
}

export const BANK_SOURCE_LABELS: Record<string, { fr: string; en: string; status: string }> = {
  csv: { fr: 'CSV bancaire', en: 'Bank CSV', status: 'supported' },
  tsv: { fr: 'TSV / TXT structuré', en: 'TSV / structured TXT', status: 'supported' },
  xlsx: { fr: 'Classeur Excel (.xlsx)', en: 'Excel workbook (.xlsx)', status: 'supported' },
  ofx: { fr: 'OFX / QFX', en: 'OFX / QFX', status: 'not_implemented' },
  pdf: { fr: 'PDF bancaire texte ou scanné (MCB prioritaire)', en: 'Text or scanned bank PDF (MCB first)', status: 'supported_with_review' },
};

/** OFX is deliberately not guessed from an extension: no partial parser ships. */
export function bankSourceForFile(fileName: string): 'csv' | 'tsv' | 'xlsx' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'tsv';
  return 'csv';
}

export function normalizeBankLabel(value: string): string {
  return normalizeHeader(value);
}
