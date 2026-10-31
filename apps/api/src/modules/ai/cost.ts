/**
 * Cost estimation - exact integer arithmetic, no floating point.
 *
 * Prices are stored in micro-USD per million tokens (numeric(12,6) in
 * PostgreSQL, i.e. 6 decimals). A cost is therefore computed as
 * `tokens × microPricePerMTok / 1_000_000` using BigInt, rounded half-up, and
 * returned as a decimal string ready for a numeric column.
 *
 * When no dated price is on file the cost is `null`: the API then reports
 * "cost unavailable" instead of a made-up amount.
 */

const MICRO = 1_000_000n;

/** "0.150000" -> 150000n (micro-USD per million tokens). */
export function parsePriceToMicro(price: string): bigint {
  const raw = price.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new Error(`Invalid price: ${raw}`);
  const [intPart = '0', decPart = ''] = raw.split('.');
  return BigInt(intPart) * MICRO + BigInt(decPart.padEnd(6, '0').slice(0, 6));
}

/** micro-USD -> "0.001234" with exactly six decimals. */
export function formatMicroUsd(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const int = abs / MICRO;
  const dec = (abs % MICRO).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${int}.${dec}`;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface PriceRow {
  inputUsdPerMTok: string;
  outputUsdPerMTok: string;
}

export interface CostEstimate {
  /** null when a price is missing or a token count is unknown. */
  microUsd: bigint | null;
  decimal: string | null;
  source: 'catalogue' | 'unknown';
  missing: ('input_tokens' | 'output_tokens' | 'price')[];
}

function mulDiv(tokens: number, microPerMTok: bigint): bigint {
  const product = BigInt(tokens) * microPerMTok;
  // Round half up on the division by one million.
  return (product + MICRO / 2n) / MICRO;
}

export function estimateCost(usage: TokenUsage, price: PriceRow | null): CostEstimate {
  const missing: CostEstimate['missing'] = [];
  if (!price) missing.push('price');
  if (usage.inputTokens === null) missing.push('input_tokens');
  if (usage.outputTokens === null) missing.push('output_tokens');
  if (missing.length > 0) {
    return { microUsd: null, decimal: null, source: 'unknown', missing };
  }
  const micro =
    mulDiv(usage.inputTokens!, parsePriceToMicro(price!.inputUsdPerMTok)) +
    mulDiv(usage.outputTokens!, parsePriceToMicro(price!.outputUsdPerMTok));
  return { microUsd: micro, decimal: formatMicroUsd(micro), source: 'catalogue', missing: [] };
}

/** Sum of decimal strings coming from PostgreSQL numerics. */
export function sumDecimal(rows: (string | null)[]): string {
  let total = 0n;
  for (const row of rows) {
    if (row === null || row === '') continue;
    total += parsePriceToMicro(row);
  }
  return formatMicroUsd(total);
}
