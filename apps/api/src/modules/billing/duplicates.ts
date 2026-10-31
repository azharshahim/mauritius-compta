import type { Db } from '../../db/index.js';
import { parseAmount } from '../../lib/money.js';

/**
 * Deterministic duplicate detection for billing documents.
 *
 * Three levels, decided by explicit rules (never by a model):
 *  - `certain`  : same normalised document number, or the same source document
 *                 was converted twice;
 *  - `probable` : same customer, same amount and a date within 3 days;
 *  - `similar`  : same amount within 31 days, or a near-identical customer
 *                 name / document number.
 *
 * Nothing is ever deleted or blocked automatically: the match is returned to
 * the UI and a human decides. The same function powers the "check before
 * creating" endpoint and the warning attached to a new document.
 */

export type DuplicateLevel = 'none' | 'similar' | 'probable' | 'certain';

export interface DuplicateCandidate {
  id: string;
  kind: string;
  docNo: string | null;
  status: string;
  customerId: string | null;
  customerName: string;
  issueDate: string;
  totalAmount: string;
  currency: string;
  sourceDocumentId: string | null;
}

export interface DuplicateMatch {
  documentId: string;
  docNo: string | null;
  status: string;
  issueDate: string;
  totalAmount: string;
  currency: string;
  customerName: string;
  level: Exclude<DuplicateLevel, 'none'>;
  reasons: string[];
}

export interface DuplicateCheck {
  level: DuplicateLevel;
  matches: DuplicateMatch[];
  /** What was compared - displayed so a human can judge the relevance. */
  compared: {
    kind: string;
    customerName: string | null;
    docNo: string | null;
    issueDate: string;
    totalAmount: string;
    currency: string;
    sourceDocumentId: string | null;
  };
}

const WEIGHT: Record<DuplicateLevel, number> = { none: 0, similar: 1, probable: 2, certain: 3 };

function normaliseText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normaliseDocNo(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokens(value: string): Set<string> {
  return new Set(normaliseText(value).split(' ').filter((w) => w.length > 1));
}

/** Jaccard similarity of the words of two names (0 = different, 1 = identical). */
export function nameSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function daysApart(a: string, b: string): number {
  const diff = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round(diff / 86_400_000));
}

/** Pure, unit-testable scoring of one candidate against the new document. */
export function scoreCandidate(
  candidate: DuplicateCandidate,
  input: {
    kind: string;
    customerId?: string | null;
    customerName?: string | null;
    docNo?: string | null;
    issueDate: string;
    totalAmount: string;
    currency: string;
    sourceDocumentId?: string | null;
  },
): { level: DuplicateLevel; reasons: string[] } {
  if (candidate.kind !== input.kind) return { level: 'none', reasons: [] };

  const reasons: string[] = [];
  let level: DuplicateLevel = 'none';

  const sameDocNo =
    normaliseDocNo(candidate.docNo) !== '' &&
    normaliseDocNo(candidate.docNo) === normaliseDocNo(input.docNo);
  if (sameDocNo) {
    level = 'certain';
    reasons.push('SAME_DOC_NUMBER: identical normalised document number');
  }

  // A second credit note on the same invoice is legitimate (partial credits),
  // so a shared source is only a *probable* duplicate, never a certain one.
  const sameSource =
    Boolean(input.sourceDocumentId) && candidate.sourceDocumentId === input.sourceDocumentId;
  if (sameSource) {
    if (WEIGHT[level] < WEIGHT.probable) level = 'probable';
    reasons.push('SAME_SOURCE_DOCUMENT: another document already references the same source');
  }

  const sameAmount = parseAmount(candidate.totalAmount) === parseAmount(input.totalAmount);
  const sameCurrency = candidate.currency === input.currency;
  const sameCustomer =
    (Boolean(input.customerId) && candidate.customerId === input.customerId) ||
    (Boolean(input.customerName) &&
      nameSimilarity(candidate.customerName, input.customerName ?? '') >= 0.85);
  const gap = daysApart(candidate.issueDate, input.issueDate);

  if (sameAmount && sameCurrency && sameCustomer && gap <= 3) {
    if (WEIGHT[level] < WEIGHT.probable) level = 'probable';
    reasons.push('SAME_CUSTOMER_SAME_AMOUNT_CLOSE_DATE: same customer, same amount, at most 3 days apart');
  } else if (sameAmount && sameCurrency && gap <= 31) {
    if (WEIGHT[level] < WEIGHT.similar) level = 'similar';
    reasons.push('SAME_AMOUNT_SAME_MONTH: same amount and currency within 31 days');
  }

  const nameClose =
    Boolean(input.customerName) &&
    nameSimilarity(candidate.customerName, input.customerName ?? '') >= 0.6 &&
    sameAmount;
  if (nameClose && WEIGHT[level] < WEIGHT.similar) {
    level = 'similar';
    reasons.push('CLOSE_CUSTOMER_NAME: similar customer name and identical amount');
  }

  if (level !== 'none' && sameDocNo === false && sameSource === false && reasons.length === 0) {
    reasons.push('AMOUNT_DATE_MATCH');
  }
  return { level, reasons };
}

export async function findDuplicates(
  db: Db,
  companyId: string,
  input: {
    kind: string;
    customerId?: string | null;
    customerName?: string | null;
    docNo?: string | null;
    issueDate: string;
    totalAmount: string;
    currency: string;
    sourceDocumentId?: string | null;
    excludeDocumentId?: string | null;
  },
): Promise<DuplicateCheck> {
  const params: unknown[] = [companyId, input.kind, input.issueDate];
  let extra = '';
  if (input.excludeDocumentId) {
    params.push(input.excludeDocumentId);
    extra += ` AND id <> $${params.length}`;
  }
  const res = await db.query<DuplicateCandidate>(
    `SELECT id, kind, doc_no AS "docNo", status, customer_id AS "customerId",
            customer_name AS "customerName", issue_date AS "issueDate",
            total_amount AS "totalAmount", currency,
            source_document_id AS "sourceDocumentId"
       FROM billing_documents
      WHERE company_id = $1 AND kind = $2
        AND status <> 'cancelled'
        AND issue_date BETWEEN ($3::date - INTERVAL '90 days') AND ($3::date + INTERVAL '90 days')${extra}
      ORDER BY issue_date DESC
      LIMIT 200`,
    params,
  );

  const matches: DuplicateMatch[] = [];
  for (const candidate of res.rows) {
    const scored = scoreCandidate(candidate, input);
    if (scored.level === 'none') continue;
    matches.push({
      documentId: candidate.id,
      docNo: candidate.docNo,
      status: candidate.status,
      issueDate: candidate.issueDate,
      totalAmount: candidate.totalAmount,
      currency: candidate.currency,
      customerName: candidate.customerName,
      level: scored.level,
      reasons: scored.reasons,
    });
  }
  matches.sort((a, b) => WEIGHT[b.level] - WEIGHT[a.level]);

  const level = matches.reduce<DuplicateLevel>(
    (worst, m) => (WEIGHT[m.level] > WEIGHT[worst] ? m.level : worst),
    'none',
  );

  return {
    level,
    matches,
    compared: {
      kind: input.kind,
      customerName: input.customerName ?? null,
      docNo: input.docNo ?? null,
      issueDate: input.issueDate,
      totalAmount: input.totalAmount,
      currency: input.currency,
      sourceDocumentId: input.sourceDocumentId ?? null,
    },
  };
}
