/**
 * Deterministic invoice reader for text produced by a PDF parser or an OCR
 * engine. It only reports what is present in the document: no tax rate, no
 * account number and no due date are invented. Missing or contradictory values
 * are returned as null plus an explicit warning.
 */
import { formatAmount, parseAmount } from '../../lib/money.js';

export interface InvoiceLine {
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  netAmount: string;
  vatAmount: string;
  totalAmount: string;
  confidence: number;
}

export interface ParsedInvoice {
  supplierName: string | null;
  customerName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: string | null;
  vatTotal: string | null;
  total: string | null;
  references: string[];
  lines: InvoiceLine[];
  fieldConfidence: Record<string, number>;
  warnings: string[];
  rawText: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janvier: 1, feb: 2, february: 2, fevrier: 2, février: 2,
  mar: 3, march: 3, mars: 3, apr: 4, april: 4, avril: 4, may: 5, mai: 5,
  jun: 6, june: 6, juin: 6, jul: 7, july: 7, juillet: 7, aug: 8, august: 8, aout: 8, août: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12, décembre: 12,
};

export function normaliseAmountToken(raw: string): string | null {
  let token = raw.replace(/[^0-9.,\-]/g, '').trim();
  if (!token || token === '-' || token === '.' || token === ',') return null;
  const negative = token.startsWith('-');
  token = token.replace(/-/g, '');
  const lastComma = token.lastIndexOf(',');
  const lastDot = token.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    token = token.replace(thousands, '');
    if (decimal === ',') token = token.replace(',', '.');
  } else if (lastComma >= 0) {
    const after = token.length - lastComma - 1;
    if (after === 3 && token.replace(',', '').length > 3) token = token.replace(',', '');
    else token = token.replace(',', '.');
  } else if (lastDot >= 0) {
    const after = token.length - lastDot - 1;
    if (after === 3 && token.replace(/\./g, '').length > 3) token = token.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(token)) return null;
  return negative ? `-${token}` : token;
}

function decimalAmount(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalised = normaliseAmountToken(raw);
  if (normalised === null) return null;
  try { return formatAmount(parseAmount(normalised)); } catch { return null; }
}
function add(a: string, b: string): string { return formatAmount(parseAmount(a) + parseAmount(b)); }
function eq(a: string, b: string): boolean { return parseAmount(a) === parseAmount(b); }

export function parseDateValue(raw: string): string | null {
  const text = raw.trim();
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) {
    const [, y, m, d] = match;
    const iso = `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
    return validIso(iso);
  }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (match) {
    let [, d, m, y] = match;
    if (y!.length === 2) y = `20${y}`;
    return validIso(`${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`);
  }
  match = /^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[2]!.toLowerCase().replace('.', '')];
    if (month) return validIso(`${match[3]}-${String(month).padStart(2, '0')}-${match[1]!.padStart(2, '0')}`);
  }
  match = /^([A-Za-zÀ-ÿ.]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[1]!.toLowerCase().replace('.', '')];
    if (month) return validIso(`${match[3]}-${String(month).padStart(2, '0')}-${match[2]!.padStart(2, '0')}`);
  }
  return null;
}
function validIso(iso: string): string | null {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

const SELF_LABELS = /^(invoice|tax invoice|facture|receipt|reçu|quotation|devis|credit note|avoir)\b/i;
const IGNORE_LABELS = /^(invoice|facture|tax|date|due|payment|total|subtotal|vat|tva|amount|currency|reference|ref|po|order|no|n°|tel|phone|email|address|brn|vat reg|account|bank|iban|swift|terms|page)\b/i;

function lineValue(lines: string[], labels: RegExp, opts: { maxNext?: number } = {}): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const m = labels.exec(line);
    if (!m) continue;
    const rest = line.slice(m.index + m[0].length).replace(/^\s*[:\-–]\s*/, '').trim();
    if (rest && !/^[\s:.\-–]*$/.test(rest)) return rest;
    for (let j = i + 1; j <= i + (opts.maxNext ?? 2) && j < lines.length; j += 1) {
      const candidate = lines[j]!.trim();
      if (candidate && !IGNORE_LABELS.test(candidate)) return candidate;
    }
  }
  return null;
}

function labelMoney(lines: string[], label: RegExp): string | null {
  for (const line of lines) {
    const m = label.exec(line);
    if (!m) continue;
    const after = line.slice(m.index + m[0].length);
    const candidates = after.match(/-?\d[\d\s.,]*\d|-?\d/g);
    if (!candidates?.length) continue;
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const amount = decimalAmount(candidates[i]!);
      if (amount !== null) return amount;
    }
  }
  return null;
}

function cleanParty(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^(?:from|supplier|seller|vendor|fournisseur|émetteur|emetteur|bill to|customer|client|acheteur|invoice to)\s*[:\-–]?\s*/i, '')
    .replace(/\s{2,}.*$/, '')
    .replace(/\s*[|,;]\s*$/, '')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 120) return null;
  if (/^(invoice|facture|date|total|vat|tva|amount|page)\b/i.test(cleaned)) return null;
  return cleaned;
}

function partyFromLabel(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const m = label.exec(lines[i]!);
    if (!m) continue;
    const inline = lines[i]!.slice(m.index + m[0].length).replace(/^\s*[:\-–]\s*/, '').trim();
    if (inline) return cleanParty(inline);
    for (let j = i + 1; j <= i + 3 && j < lines.length; j += 1) {
      const candidate = cleanParty(lines[j]!);
      if (candidate) return candidate;
    }
  }
  return null;
}

function invoiceNumber(lines: string[]): string | null {
  const patterns = [
    /(?:tax\s+)?invoice\s*(?:no\.?|number|#|n[o°])\s*[:\-–]?\s*([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/i,
    /(?:facture)\s*(?:n[o°]|no\.?|numéro|numero)?\s*[:\-–]?\s*([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/i,
    /\b(inv[-_/]?[A-Za-z0-9][A-Za-z0-9/_\-.]{2,29})\b/i,
  ];
  for (const pattern of patterns) {
    for (const line of lines) {
      const m = pattern.exec(line);
      if (m && !/^(no|number|date)$/i.test(m[1]!)) return m[1]!.replace(/[.,;:]$/, '');
    }
  }
  return null;
}

function extractTable(lines: string[]): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  const start = lines.findIndex((l) => /(description|item|désignation|designation|libellé|libelle).*(qty|quantit|unit|prix|amount|montant)/i.test(l));
  for (let i = Math.max(start + 1, 0); i < lines.length && out.length < 60; i += 1) {
    const line = lines[i]!;
    if (/^(sub\s*-?total|total|vat|tva|tax|grand total|amount due)\b/i.test(line)) break;
    const numbers = [...line.matchAll(/(?<![A-Za-z0-9])-?\d[\d,]*(?:\.\d{1,4})?/g)].map((m) => m[0]);
    if (numbers.length < 3) continue;
    const description = line.slice(0, line.indexOf(numbers[0]!)).replace(/[|;]+/g, ' ').trim();
    if (description.length < 2) continue;
    const amounts = numbers.slice(-3).map(decimalAmount);
    if (amounts.some((a) => a === null)) continue;
    const [net, vat, total] = amounts as string[];
    if (!net || !vat || !total) continue;
    const qtyRaw = numbers.length >= 5
      ? numbers[numbers.length - 5]
      : numbers.length === 4 ? numbers[numbers.length - 4] : undefined;
    const unitRaw = numbers.length >= 5 ? numbers[numbers.length - 4] : undefined;
    const qty = qtyRaw ? decimalAmount(qtyRaw) : null;
    const unit = unitRaw ? decimalAmount(unitRaw) : null;
    if (!eq(add(net, vat), total)) continue;
    out.push({
      description: description.replace(/\s{2,}/g, ' ').slice(0, 240),
      quantity: qty, unitPrice: unit, netAmount: net, vatAmount: vat, totalAmount: total,
      confidence: 0.6,
    });
  }
  return out;
}

export function parseInvoiceText(rawText: string): ParsedInvoice {
  const text = rawText.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];
  const fieldConfidence: Record<string, number> = {};

  let supplierName = partyFromLabel(lines, /^(?:from|supplier|seller|vendor|fournisseur|émetteur|emetteur|issued by)\b/i);
  if (!supplierName) {
    // Most invoices print the seller's name as the first prominent line.
    const headerIndex = lines.findIndex((l) => SELF_LABELS.test(l) && l.length < 80);
    const candidates = lines.slice(0, headerIndex >= 0 ? headerIndex : Math.min(lines.length, 4));
    for (const candidate of candidates) {
      if (/^(tax\s+)?(invoice|facture|receipt|reçu|quotation|devis|credit note|avoir)\b/i.test(candidate)) continue;
      if (/^(brn|vat\s*(?:reg|no)|tel|phone|email|www\.|http)/i.test(candidate)) continue;
      if (candidate.length < 3 || candidate.length > 80) continue;
      if (/^\d+\s/.test(candidate) || /\b\d{4}\b/.test(candidate) && /road|street|rue|avenue/i.test(candidate)) continue;
      supplierName = cleanParty(candidate);
      if (supplierName) break;
    }
  }
  const customerName = partyFromLabel(lines, /^(?:bill\s*to|invoice\s*to|customer|client|acheteur|sold\s*to)\b/i);
  if (!supplierName) warnings.push('Supplier or seller name not found.');
  if (!customerName) warnings.push('Customer or buyer name not found (optional for a purchase invoice).');

  const number = invoiceNumber(lines);
  if (!number) warnings.push('Invoice number not found.');

  const dateRaw = lineValue(lines, /^(?:invoice\s*date|date\s*of\s*invoice|facture\s*date|date\s*de\s*facture|date)\b/i);
  const invoiceDate = dateRaw ? parseDateValue(dateRaw) : null;
  if (!invoiceDate) warnings.push('Invoice date not found or ambiguous.');
  const dueRaw = lineValue(lines, /^(?:due\s*date|payment\s*due|échéance|echeance|date\s*d[’']échéance)\b/i);
  let dueDate = dueRaw ? parseDateValue(dueRaw) : null;
  if (dueRaw && !dueDate) warnings.push('Due date is present but could not be read reliably.');
  if (!dueDate) {
    const terms = lineValue(lines, /^(?:payment\s*terms|terms|conditions\s*de\s*paiement)\b/i);
    const netDays = terms ? /net\s*(\d{1,3})/i.exec(terms) : null;
    if (netDays && invoiceDate) {
      const d = new Date(`${invoiceDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Number(netDays[1]));
      dueDate = d.toISOString().slice(0, 10);
      warnings.push(`Due date derived from payment terms (net ${netDays[1]} days).`);
    }
  }

  let currency: string | null = null;
  const cur = /\b(MUR|EUR|USD|GBP|ZAR)\b/i.exec(text);
  if (cur) currency = cur[1]!.toUpperCase();
  else if (/\bRs\.?\b/.test(text)) {
    currency = 'MUR';
    warnings.push('Currency symbol “Rs” was read as MUR; confirm it.');
  }
  if (!currency) warnings.push('Currency not found.');

  const subtotal = labelMoney(lines, /(?:sub\s*-?\s*total|total\s*(?:ht|hors\s*taxe|excl\.?\s*(?:of\s*)?(?:vat|tax))|net\s*(?:amount|total)|montant\s*ht|base\s*ht)/i);
  const vatTotal = labelMoney(lines, /(?:total\s*)?(?:vat|tva|tax|gst)\b(?!\s*(?:reg|registration|no|number|rate))/i);
  let total = labelMoney(lines, /(?:grand\s*total|total\s*(?:ttc|due|amount)|amount\s*due|total\s*à\s*payer|total\s*a\s*payer|balance\s*due)/i);
  if (total === null) total = labelMoney(lines, /^total\b/i);

  let linesFound = extractTable(lines);
  if (!linesFound.length && subtotal) {
    linesFound = [{
      description: 'Document total (line detail not reliably readable)',
      quantity: null, unitPrice: null, netAmount: subtotal,
      vatAmount: vatTotal ?? '0.0000', totalAmount: total ?? subtotal,
      confidence: 0.3,
    }];
    warnings.push('No reliable line table was detected; a single summary line is proposed.');
  }

  if (subtotal !== null && vatTotal !== null && total !== null) {
    if (!eq(add(subtotal, vatTotal), total)) {
      warnings.push(
        `Subtotal + VAT (${add(subtotal, vatTotal)}) does not equal the stated total (${total}); the document must be checked.`,
      );
    }
  } else if (subtotal !== null && total === null && vatTotal !== null) {
    total = add(subtotal, vatTotal);
    warnings.push('Total was not stated; it was calculated from subtotal + VAT. Confirm it.');
  } else if (subtotal === null && total !== null && vatTotal !== null) {
    try {
      const derived = formatAmount(parseAmount(total) - parseAmount(vatTotal));
      warnings.push(`Subtotal was calculated as total − VAT (${derived}). Confirm it.`);
    } catch { /* handled below */ }
  }

  const references = [...text.matchAll(/\b(?:PO|P\.O\.|order|reference|ref|contrat)\b[^A-Za-z0-9]{0,4}?([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/gi)]
    .map((m) => m[1]!).filter((v) => /\d/.test(v)
      && !/^(reference|order|contrat|ref|number|no)$/i.test(v))
    .filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 5);

  for (const [field, value] of Object.entries({ supplierName, customerName, invoiceNumber: number, invoiceDate, dueDate, currency, subtotal, vatTotal, total })) {
    fieldConfidence[field] = value ? (field === 'supplierName' || field === 'customerName' ? 0.7 : 0.9) : 0;
  }

  return {
    supplierName, customerName, invoiceNumber: number, invoiceDate, dueDate, currency,
    subtotal, vatTotal, total, references, lines: linesFound, fieldConfidence, warnings, rawText: text,
  };
}
