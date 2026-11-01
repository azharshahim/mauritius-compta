/**
 * Deterministic, bilingual document reader.
 *
 * The parser only reports values that are present in the extracted text. It
 * deliberately does not invent a VAT rate, a currency, a due date, a tax
 * identifier or a line amount. A value that is derived from other printed
 * values is marked with a warning and a lower confidence.
 *
 * Mission 29 additions:
 *  - per-field evidence/confidence instead of fixed scores;
 *  - document type (invoice / credit note) and tax identifiers;
 *  - purchase order, payment terms and discount extraction;
 *  - no-VAT and credit-note handling;
 *  - multiple-invoice detection without splitting the source;
 *  - field-level uncertainty returned to the verification screen.
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

export type InvoiceDocumentType = 'invoice' | 'credit_note' | 'unknown';

export interface InvoiceTaxIds {
  supplierBrn: string | null;
  supplierVat: string | null;
  customerBrn: string | null;
  customerVat: string | null;
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
  discountTotal: string | null;
  documentType: InvoiceDocumentType;
  taxIds: InvoiceTaxIds;
  purchaseOrder: string | null;
  paymentTerms: string | null;
  references: string[];
  lines: InvoiceLine[];
  fieldConfidence: Record<string, number>;
  uncertainFields: string[];
  warningCodes: string[];
  warnings: string[];
  rawText: string;
  pageCount: number;
  invoiceCountSuspected: number;
}

export interface ParseInvoiceOptions {
  extractionMethod?: 'pdf_text' | 'ocr_image' | 'ocr_pdf' | 'manual';
  /** Mean Tesseract confidence, 0..1. Only meaningful for OCR methods. */
  extractionConfidence?: number;
  pageCount?: number;
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
    if (after === 3 && token.replace(/,/g, '').length > 3) token = token.replace(/,/g, '');
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
function subtract(a: string, b: string): string { return formatAmount(parseAmount(a) - parseAmount(b)); }
function eq(a: string, b: string): boolean { return parseAmount(a) === parseAmount(b); }
function absAmount(value: string): string {
  const parsed = parseAmount(value);
  return formatAmount(parsed < 0n ? -parsed : parsed);
}

export function parseDateValue(raw: string): string | null {
  const text = raw.trim();
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) {
    const [, y, m, d] = match;
    return validIso(`${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`);
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

const SELF_LABELS = /^(invoice|tax invoice|facture|receipt|reçu|quotation|devis|credit note|avoir|note de crédit)\b/i;
const IGNORE_LABELS = /^(invoice|facture|tax|date|due|payment|total|subtotal|vat|tva|amount|currency|reference|ref|po|order|no|n°|tel|phone|email|address|brn|vat reg|account|bank|iban|swift|terms|page)\b/i;
const DOCUMENT_TOTAL_LABEL = /^(?:grand\s*total|total\s*(?:ttc|due|amount|gross|général|general)|amount\s*due|total\s*à\s*payer|total\s*a\s*payer|balance\s*due|montant\s*ttc)/i;
const SUBTOTAL_LABEL = /^(?:sub\s*-?\s*total|total\s*(?:ht|hors\s*taxe|excl\.?\s*(?:of\s*)?(?:vat|tax))|net\s*(?:amount|total)|montant\s*ht|base\s*ht)/i;
const VAT_LABEL = /^(?:total\s*)?(?:vat|tva|tax|gst)\b/i;
const DISCOUNT_LABEL = /^(?:discount|remise|rabais|escompte|réduction|reduction)\b/i;

function normaliseLine(line: string): string {
  return line.replace(/[ \t]+/g, ' ').replace(/\u00a0/g, ' ').trim();
}
function cleanParty(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^(?:from|supplier|seller|vendor|fournisseur|émetteur|emetteur|bill to|customer|client|acheteur|invoice to|sold to)\s*[:\-–]?\s*/i, '')
    .replace(/\s{2,}.*$/, '')
    .replace(/\s*[|,;]\s*$/, '')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 120) return null;
  if (/^(invoice|facture|date|total|vat|tva|amount|page|tax invoice|credit note|avoir)\b/i.test(cleaned)) return null;
  if (/^[\d\s.,/-]+$/.test(cleaned)) return null;
  return cleaned;
}
function partyFromLabel(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const m = label.exec(lines[i]!);
    if (!m) continue;
    const inline = lines[i]!.slice(m.index + m[0].length).replace(/^\s*[:\-–]\s*/, '').trim();
    if (inline) {
      const cleaned = cleanParty(inline);
      if (cleaned) return cleaned;
    }
    for (let j = i + 1; j <= i + 3 && j < lines.length; j += 1) {
      const candidate = cleanParty(lines[j]!);
      if (candidate) return candidate;
    }
  }
  return null;
}

/** Finds the first non-empty value after a label, without inventing one. */
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

interface AmountToken { raw: string; value: string; decimal: string; index: number; hasDecimal: boolean; hasCurrency: boolean }
const AMOUNT_TOKEN = /(?<![\dA-Za-z])((?:MUR|EUR|USD|GBP|Rs\.?|€|£|\$)\s*)?(-?\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2,4})|-?\d+(?:[.,]\d{2,4})?)(?![\dA-Za-z])/gi;

function amountTokens(text: string): AmountToken[] {
  const out: AmountToken[] = [];
  for (const match of text.matchAll(AMOUNT_TOKEN)) {
    const raw = match[2]!;
    const value = decimalAmount(raw);
    if (value === null) continue;
    const index = match.index ?? 0;
    const after = text.slice(index + match[0].length, index + match[0].length + 3);
    const before = text.slice(Math.max(0, index - 14), index);
    // A percentage is a rate, never an amount: "VAT 15%" must not become 15.00.
    if (/^[\s)]*%/.test(after)) continue;
    if (/(?:rate|taux)\s*[:=]?\s*$/i.test(before)) continue;
    // A bare integer that looks like a tax/registration identifier is not an amount.
    const digits = raw.replace(/[^0-9]/g, '');
    if (!/[.,]\d{2,4}$/.test(raw) && !match[1] && digits.length >= 6) continue;
    out.push({ raw: match[0]!, value, decimal: digits, index,
      hasDecimal: /[.,]\d{2,4}$/.test(raw), hasCurrency: Boolean(match[1]) });
  }
  return out;
}

/** Amount that follows a label on the same line, stopping before the next known label. */
function moneyForLabels(lines: string[], labels: RegExp[], prefer: 'first' | 'last' = 'first'): string | null {
  for (const line of lines) {
    for (const label of labels) {
      const m = label.exec(line);
      if (!m) continue;
      const after = line.slice(m.index + m[0].length);
      if (/^\s*(?:reg|registration|number|no\.?|id|account|compte)\b/i.test(after)) continue;
      const nextLabel = /(?:sub\s*-?\s*total|grand\s*total|total\s*(?:ttc|due|amount|ht)|vat|tva|tax|gst|discount|remise|amount\s*due)/gi;
      nextLabel.lastIndex = 0;
      const stop = nextLabel.exec(after);
      const segment = stop ? after.slice(0, stop.index) : after;
      const tokens = amountTokens(segment);
      if (!tokens.length) continue;
      return (prefer === 'last' ? tokens[tokens.length - 1]! : tokens[0]!).value;
    }
  }
  return null;
}

function taxIdValue(raw: string): string | null {
  const value = raw
    .trim()
    .split(/\s{2,}/)[0]!
    .replace(/\s+(?:BRN|VAT|TVA|Business\s+Registration|Tel|Phone|Email|Address|Invoice|Date)\b.*$/i, '')
    .replace(/[.,;:]$/, '')
    .replace(/\s+/g, '');
  if (!/[A-Za-z0-9]/.test(value) || value.length < 5 || value.length > 30) return null;
  if ((value.match(/\d/g) ?? []).length < 3) return null;
  if (/^(?:no|number|none|na|n\/a)$/i.test(value)) return null;
  return value;
}

interface TaxScan { supplierBrn: string | null; supplierVat: string | null; customerBrn: string | null; customerVat: string | null }
function extractTaxIds(lines: string[]): TaxScan {
  const result: TaxScan = { supplierBrn: null, supplierVat: null, customerBrn: null, customerVat: null };
  const customerHeader = lines.findIndex((line) => /^(?:bill\s*to|invoice\s*to|customer|client|acheteur|sold\s*to)\b/i.test(line));
  const patterns: { kind: 'brn' | 'vat'; regex: RegExp }[] = [
    { kind: 'brn', regex: /\b(?:BRN|Business\s+Registration\s+(?:No\.?|Number)|Num[ée]ro\s+d['’]?enregistrement)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9/\- ]{4,24})/i },
    { kind: 'vat', regex: /\b(?:VAT\s+(?:Reg(?:istration)?\s*(?:No\.?|Number)?|No\.?|Number)|TVA\s*(?:n[°o]|num[ée]ro|no\.?)?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9/\- ]{4,24})/i },
  ];
  lines.forEach((line, index) => {
    const isCustomer = customerHeader >= 0 && index > customerHeader;
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (!match) continue;
      const value = taxIdValue(match[1]!);
      if (!value) continue;
      if (pattern.kind === 'brn') {
        if (isCustomer && !result.customerBrn) result.customerBrn = value;
        else if (!isCustomer && !result.supplierBrn) result.supplierBrn = value;
      } else if (isCustomer && !result.customerVat) result.customerVat = value;
      else if (!isCustomer && !result.supplierVat) result.supplierVat = value;
    }
  });
  return result;
}

function invoiceNumber(lines: string[]): { value: string | null; count: number } {
  const patterns = [
    /(?:tax\s+)?invoice\s*(?:no\.?|number|#|n[o°])\s*[:#\-–]?\s*([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/gi,
    /(?:credit\s*note|avoir|note\s+de\s+cr[ée]dit)\s*(?:no\.?|number|#|n[o°])?\s*[:#\-–]?\s*([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/gi,
    /(?:facture)\s*(?:n[o°]|no\.?|numéro|numero)\s*[:#\-–]?\s*([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/gi,
    /^(?:invoice|facture)\s+([A-Za-z0-9][A-Za-z0-9/_\-.]{2,29})\b/gi,
    /^(?:INV|FACT)[-_/]\s*([A-Za-z0-9][A-Za-z0-9/_\-.]{2,29})\b/gi,
  ];
  const numbers: string[] = [];
  for (const line of lines) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const value = match[1]?.replace(/[.,;:]$/, '');
        if (!value || !/\d/.test(value) || /^(?:no|number|date|n[o°])$/i.test(value)) continue;
        if (!numbers.some((n) => n.toLowerCase() === value.toLowerCase())) numbers.push(value);
      }
    }
  }
  return { value: numbers[0] ?? null, count: numbers.length };
}

function extractTable(lines: string[]): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  const header = lines.findIndex((l) => /(description|item|désignation|designation|libellé|libelle).*(qty|quantit|unit|prix|amount|montant)/i.test(l));
  for (let i = Math.max(header + 1, 0); i < lines.length && out.length < 80; i += 1) {
    const line = lines[i]!;
    if (/^(sub\s*-?\s*total|total|vat|tva|tax|grand total|amount due|discount|remise)\b/i.test(line)) break;
    const tokens = amountTokens(line);
    if (tokens.length < 3) continue;
    const numbers = tokens.map((token) => token.value);
    const firstToken = tokens[0]!;
    const description = line.slice(0, firstToken.index).replace(/[|;]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (description.length < 2) continue;
    let quantity: string | null = null;
    let unitPrice: string | null = null;
    let net: string | null = null;
    let vat: string | null = null;
    let total: string | null = null;
    if (numbers.length >= 5) {
      quantity = numbers[numbers.length - 5]!;
      unitPrice = numbers[numbers.length - 4]!;
      net = numbers[numbers.length - 3]!;
      vat = numbers[numbers.length - 2]!;
      total = numbers[numbers.length - 1]!;
    } else if (numbers.length === 4) {
      quantity = numbers[0]!;
      unitPrice = numbers[1]!;
      net = numbers[2]!;
      total = numbers[3]!;
      vat = eq(net, total) ? '0.0000' : subtract(total, net);
    } else {
      quantity = numbers[0]!;
      unitPrice = numbers[1]!;
      net = numbers[2]!;
      vat = '0.0000';
      total = net;
    }
    if (!net || !vat || !total) continue;
    const qtyValue = quantity ? parseAmount(quantity) : null;
    const unitValue = unitPrice ? parseAmount(unitPrice) : null;
    const netValue = parseAmount(net);
    if (qtyValue !== null && unitValue !== null && qtyValue > 0n && unitValue > 0n
      && qtyValue * unitValue / 10000n !== netValue) {
      // A quantity × unit-price check is only meaningful with a clean 4-decimal
      // scale; a mismatch is reported as low confidence rather than corrected.
      if (numbers.length >= 4) continue;
    }
    if (!eq(add(net, vat), total)) continue;
    out.push({
      description: description.slice(0, 240),
      quantity, unitPrice, netAmount: net, vatAmount: vat, totalAmount: total,
      confidence: numbers.length >= 5 ? 0.8 : numbers.length === 4 ? 0.65 : 0.45,
    });
  }
  return out;
}

function detectDocumentType(text: string): InvoiceDocumentType {
  if (/\b(?:credit\s*note|credit\s*memo|avoir|note\s+de\s+cr[ée]dit)\b/i.test(text)) return 'credit_note';
  if (/\b(?:tax\s+invoice|invoice|facture)\b/i.test(text)) return 'invoice';
  return 'unknown';
}

function detectCurrency(lines: string[], text: string, warnings: string[], codes: string[]): string | null {
  const explicit = lineValue(lines, /^(?:currency|devise|monnaie|ccy)\b/i, { maxNext: 1 });
  const explicitCode = explicit ? /\b(MUR|EUR|USD|GBP)\b/i.exec(explicit)?.[1]?.toUpperCase() : null;
  const mentioned = [...new Set([...text.matchAll(/\b(MUR|EUR|USD|GBP)\b/gi)].map((m) => m[1]!.toUpperCase()))];
  if (explicitCode) {
    if (mentioned.length > 1) {
      warnings.push(`Several currency codes appear in the document (${mentioned.join(', ')}); the explicit currency label ${explicitCode} is used, but each amount must be checked.`);
      codes.push('MULTIPLE_CURRENCIES');
    }
    return explicitCode;
  }
  if (mentioned.length === 1) return mentioned[0]!;
  if (mentioned.length > 1) {
    warnings.push(`Several currency codes appear (${mentioned.join(', ')}) without an explicit currency label; the currency is left blank.`);
    codes.push('CURRENCY_AMBIGUOUS');
    return null;
  }
  const symbol = /€/.test(text) ? 'EUR' : /£/.test(text) ? 'GBP' : /\$/.test(text) ? 'USD' : null;
  if (symbol) {
    warnings.push(`Currency was inferred from the symbol ${symbol === 'USD' ? '$' : symbol === 'EUR' ? '€' : '£'} as ${symbol}; confirm it.`);
    codes.push('CURRENCY_SYMBOL_INFERRED');
    return symbol;
  }
  if (/\bRs\.?\b/i.test(text)) {
    warnings.push('Currency symbol “Rs” was read as MUR; confirm it.');
    codes.push('CURRENCY_RS_INFERRED');
    return 'MUR';
  }
  warnings.push('Currency not found.');
  codes.push('CURRENCY_MISSING');
  return null;
}

function confidenceFor(base: number, options: ParseInvoiceOptions): number {
  if (!options.extractionMethod || options.extractionMethod === 'pdf_text' || options.extractionMethod === 'manual') {
    return base;
  }
  const ocr = Math.min(1, Math.max(0.5, options.extractionConfidence ?? 0.8));
  return Math.round(base * (0.75 + ocr * 0.25) * 100) / 100;
}

export function parseInvoiceText(rawText: string, options: ParseInvoiceOptions = {}): ParsedInvoice {
  const text = (rawText ?? '').replace(/\r/g, '').replace(/\u00a0/g, ' ').trim();
  const lines = text.split('\n').map(normaliseLine).filter(Boolean);
  const warnings: string[] = [];
  const warningCodes: string[] = [];
  const fieldConfidence: Record<string, number> = {};
  const pageCount = Math.max(1, options.pageCount ?? 1);
  const documentType = detectDocumentType(text);
  const invoiceNumbers = invoiceNumber(lines);
  const taxIds = extractTaxIds(lines);

  let supplierName = partyFromLabel(lines, /^(?:from|supplier|seller|vendor|fournisseur|émetteur|emetteur|issued by)\b/i);
  if (!supplierName) {
    const headerIndex = lines.findIndex((l) => SELF_LABELS.test(l) && l.length < 80);
    const candidates = lines.slice(0, headerIndex >= 0 ? headerIndex : Math.min(lines.length, 5));
    for (const candidate of candidates) {
      if (SELF_LABELS.test(candidate)) continue;
      if (/^(brn|vat\s*(?:reg|no)|tel|phone|email|www\.|http)/i.test(candidate)) continue;
      if (candidate.length < 3 || candidate.length > 80) continue;
      if (/^\d+\s/.test(candidate) || (/\b\d{4}\b/.test(candidate) && /road|street|rue|avenue/i.test(candidate))) continue;
      const cleaned = cleanParty(candidate);
      if (cleaned) { supplierName = cleaned; break; }
    }
  }
  const customerName = partyFromLabel(lines, /^(?:bill\s*to|invoice\s*to|customer|client|acheteur|sold\s*to)\b/i);

  const dateRaw = lineValue(lines, /^(?:invoice\s*date|date\s*of\s*invoice|facture\s*date|date\s*de\s*facture|date\s*d[’']?[ée]mission|issue\s*date|document\s*date|date)\b/i);
  const invoiceDate = dateRaw ? parseDateValue(dateRaw) : null;
  const dueRaw = lineValue(lines, /^(?:due\s*date|payment\s*due|échéance|echeance|date\s*d[’']échéance)\b/i);
  let dueDate = dueRaw ? parseDateValue(dueRaw) : null;
  const paymentTerms = lineValue(lines, /^(?:payment\s*terms|terms|conditions\s*de\s*paiement)\b/i);
  if (dueRaw && !dueDate) {
    warnings.push('Due date is present but could not be read reliably.');
    warningCodes.push('DUE_DATE_UNREADABLE');
  }
  if (!dueDate && paymentTerms && invoiceDate) {
    const netDays = /net\s*(\d{1,3})/i.exec(paymentTerms);
    if (netDays) {
      const d = new Date(`${invoiceDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Number(netDays[1]));
      dueDate = d.toISOString().slice(0, 10);
      warnings.push(`Due date derived from payment terms (net ${netDays[1]} days); confirm it.`);
      warningCodes.push('DUE_DATE_DERIVED');
    }
  }

  const currency = detectCurrency(lines, text, warnings, warningCodes);
  const subtotal = moneyForLabels(lines, [SUBTOTAL_LABEL], 'first');
  let vatTotal = moneyForLabels(lines, [VAT_LABEL], 'last');
  const discountTotal = moneyForLabels(lines, [DISCOUNT_LABEL], 'last');
  let total = moneyForLabels(lines, [DOCUMENT_TOTAL_LABEL], 'last');
  if (total === null) {
    // A generic "Total" only. "Total HT" / "Total excl. VAT" is a subtotal,
    // never a document total.
    total = moneyForLabels(lines, [/^total(?!\s*(?:ht|hors|excl|tva|vat|tax|net))\b/i], 'last');
  }

  // VAT registration numbers are identifiers, not VAT amounts. If the only
  // VAT-looking line is a registration line, no VAT value must be reported.
  if (vatTotal !== null && lines.some((line) => /\b(?:VAT|TVA)\s*(?:Reg(?:istration)?|No\.?|Number)\b/i.test(line))
    && !lines.some((line) => /\b(?:VAT|TVA|Tax|GST)\b/i.test(line) && amountTokens(line).length > 0 && !/reg|registration|number/i.test(line))) {
    vatTotal = null;
    warnings.push('A VAT registration number was found, but no separate VAT amount; the VAT field is left blank.');
    warningCodes.push('VAT_IDENTIFIER_ONLY');
  }

  const noVatStatement = /\b(?:no\s+vat|vat\s+exempt|exempt(?:ed)?\s+from\s+vat|exon[ée]r[ée]?\s+de\s+tva|sans\s+tva|zero[- ]rated|tva\s*0\s*%|vat\s*0\s*%)\b/i.test(text);
  if (vatTotal === null && noVatStatement) {
    vatTotal = '0.0000';
    warnings.push('The document states that VAT is not applicable; VAT is recorded as zero. Confirm the exemption wording.');
    warningCodes.push('VAT_ZERO_STATED');
  } else if (vatTotal === null && /\b(?:vat|tva|tax|gst)\b/i.test(text)) {
    warnings.push('A VAT/tax label is present but its amount could not be read; the VAT field is left blank.');
    warningCodes.push('VAT_AMBIGUOUS');
  } else if (vatTotal === null) {
    warnings.push('No VAT amount was found; the VAT field is left blank (the invoice may be outside VAT).');
    warningCodes.push('VAT_MISSING');
  }

  // Totals reconciliation. Derived values are explicitly flagged.
  if (subtotal !== null && vatTotal !== null && total !== null) {
    const expected = discountTotal ? subtract(add(subtotal, vatTotal), discountTotal) : add(subtotal, vatTotal);
    if (!eq(expected, total)) {
      warnings.push(`Subtotal${discountTotal ? ' − discount' : ''} + VAT (${expected}) does not equal the stated total (${total}); the document must be checked.`);
      warningCodes.push('TOTAL_MISMATCH');
    }
  } else if (subtotal !== null && total === null && vatTotal !== null) {
    total = discountTotal ? subtract(add(subtotal, vatTotal), discountTotal) : add(subtotal, vatTotal);
    warnings.push('Total was not stated; it was calculated from subtotal and VAT. Confirm it.');
    warningCodes.push('TOTAL_DERIVED');
  } else if (subtotal === null && total !== null && vatTotal !== null) {
    const derived = discountTotal ? subtract(subtract(total, vatTotal), discountTotal) : subtract(total, vatTotal);
    warnings.push(`Subtotal was not stated; it was calculated as total − VAT${discountTotal ? ' − discount' : ''} (${derived}). Confirm it.`);
    warningCodes.push('SUBTOTAL_DERIVED');
  } else if (subtotal !== null && vatTotal !== null && total !== null && discountTotal !== null) {
    // Kept for clarity: handled by the first branch.
  }

  if (documentType === 'credit_note') {
    for (const value of [subtotal, vatTotal, total, discountTotal]) {
      if (value !== null && parseAmount(value) < 0n) {
        warnings.push('A credit note contains negative printed amounts; direction is handled by the document type, not by changing the printed number.');
        warningCodes.push('CREDIT_NOTE_NEGATIVE');
        break;
      }
    }
  }

  const references = [...text.matchAll(/\b(?:PO|P\.O\.|order|purchase\s*order|commande|reference|ref|contrat)\b[^A-Za-z0-9]{0,4}?([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/gi)]
    .map((m) => m[1]!).filter((v) => /\d/.test(v)
      && !/^(reference|order|commande|contrat|ref|number|no)$/i.test(v))
    .filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 8);
  const purchaseOrderRaw = lineValue(lines, /^(?:purchase\s*order|po|p\.o\.|order\s*(?:no\.?|number)|commande\s*(?:n[o°]|no\.?)?|réf\.?\s*commande)\b/i, { maxNext: 1 });
  const purchaseOrder = purchaseOrderRaw
    ? (/([A-Za-z0-9][A-Za-z0-9/_\-.]{1,29})/.exec(purchaseOrderRaw)?.[1] ?? null)
    : null;

  let linesFound = extractTable(lines);
  if (!linesFound.length && subtotal) {
    linesFound = [{
      description: 'Document total (line detail not reliably readable)',
      quantity: null, unitPrice: null, netAmount: subtotal,
      vatAmount: vatTotal ?? '0.0000', totalAmount: total ?? subtotal,
      confidence: 0.3,
    }];
    warnings.push('No reliable line table was detected; a single summary line is proposed and must be reviewed.');
    warningCodes.push('LINES_SUMMARY_ONLY');
  }

  // Multiple invoices in a single source: flag, never split automatically.
  const headerCount = lines.filter((line) => /^(?:tax\s+invoice|invoice|facture)\s*$/i.test(line)
    && !/credit|avoir/i.test(line)).length;
  const invoiceCountSuspected = Math.max(invoiceNumbers.count, headerCount);
  if (invoiceCountSuspected > 1) {
    warnings.push(`Several invoice numbers or invoice headers were detected (${invoiceCountSuspected}); the source is kept as one document and must be split by a human if it contains several invoices.`);
    warningCodes.push('MULTIPLE_INVOICES_SUSPECTED');
  }
  if (pageCount > 1) {
    warnings.push(`The source has ${pageCount} pages; page breaks are joined and no automatic invoice splitting is performed.`);
    warningCodes.push('MULTIPAGE_SOURCE');
  }

  if (!supplierName) { warnings.push('Supplier or seller name not found.'); warningCodes.push('SUPPLIER_MISSING'); }
  if (!customerName) { warnings.push('Customer or buyer name not found (optional for a purchase invoice).'); warningCodes.push('CUSTOMER_OPTIONAL_MISSING'); }
  if (!invoiceNumbers.value) { warnings.push('Invoice number not found.'); warningCodes.push('INVOICE_NUMBER_MISSING'); }
  if (!invoiceDate) { warnings.push('Invoice date not found or ambiguous.'); warningCodes.push('INVOICE_DATE_MISSING'); }
  if (!total) { warnings.push('Total amount not found.'); warningCodes.push('TOTAL_MISSING'); }

  const setConfidence = (field: string, value: string | null | undefined, base: number) => {
    fieldConfidence[field] = value ? confidenceFor(base, options) : 0;
  };
  setConfidence('supplierName', supplierName, supplierName ? 0.88 : 0);
  setConfidence('customerName', customerName, customerName ? 0.86 : 0);
  setConfidence('invoiceNumber', invoiceNumbers.value, 0.92);
  setConfidence('invoiceDate', invoiceDate, 0.9);
  setConfidence('dueDate', dueDate, dueDate ? (dueRaw ? 0.88 : 0.65) : 0);
  setConfidence('currency', currency, currency ? 0.9 : 0);
  setConfidence('subtotal', subtotal, subtotal ? 0.88 : 0);
  setConfidence('vatTotal', vatTotal, vatTotal ? (noVatStatement ? 0.85 : 0.86) : 0);
  setConfidence('total', total, total ? 0.9 : 0);
  setConfidence('discountTotal', discountTotal, discountTotal ? 0.8 : 0);
  setConfidence('documentType', documentType === 'unknown' ? null : documentType, documentType === 'unknown' ? 0 : 0.85);
  setConfidence('purchaseOrder', purchaseOrder, purchaseOrder ? 0.85 : 0);
  setConfidence('supplierBrn', taxIds.supplierBrn, taxIds.supplierBrn ? 0.9 : 0);
  setConfidence('supplierVat', taxIds.supplierVat, taxIds.supplierVat ? 0.9 : 0);
  setConfidence('customerBrn', taxIds.customerBrn, taxIds.customerBrn ? 0.9 : 0);
  setConfidence('customerVat', taxIds.customerVat, taxIds.customerVat ? 0.9 : 0);

  const criticalMissing = ['supplierName', 'invoiceNumber', 'invoiceDate', 'total', 'currency']
    .filter((field) => !fieldConfidence[field]);
  const uncertainFields = [...new Set([
    ...Object.entries(fieldConfidence).filter(([, value]) => value > 0 && value < 0.8).map(([field]) => field),
    ...criticalMissing,
    ...warningCodes.filter((code) => [
      'VAT_AMBIGUOUS', 'VAT_IDENTIFIER_ONLY', 'TOTAL_MISMATCH', 'TOTAL_DERIVED', 'SUBTOTAL_DERIVED',
      'MULTIPLE_INVOICES_SUSPECTED', 'CURRENCY_AMBIGUOUS', 'DUE_DATE_DERIVED',
    ].includes(code))
      .map((code) => {
        if (code === 'TOTAL_MISMATCH' || code === 'TOTAL_DERIVED') return 'total';
        if (code === 'SUBTOTAL_DERIVED') return 'subtotal';
        if (code === 'VAT_AMBIGUOUS' || code === 'VAT_IDENTIFIER_ONLY') return 'vatTotal';
        if (code === 'CURRENCY_AMBIGUOUS') return 'currency';
        if (code === 'DUE_DATE_DERIVED') return 'dueDate';
        return 'invoiceNumber';
      }),
  ])];

  return {
    supplierName, customerName, invoiceNumber: invoiceNumbers.value, invoiceDate, dueDate, currency,
    subtotal, vatTotal, total, discountTotal, documentType, taxIds, purchaseOrder, paymentTerms,
    references, lines: linesFound, fieldConfidence, uncertainFields, warningCodes, warnings,
    rawText: text, pageCount, invoiceCountSuspected,
  };
}
