/**
 * Deterministic helpers shared by the simulated provider and the demo build.
 *
 * No randomness, no network, no cost: the same description always yields the
 * same suggestion, which makes the demonstration reproducible in tests.
 */

export interface SimulatedAccount {
  code: string;
  name: string;
  type: string;
}

export interface AccountMatch extends SimulatedAccount {
  matched: boolean;
  score: number;
}

const KEYWORDS: { pattern: RegExp; category: string; account: RegExp }[] = [
  { pattern: /fourniture|papeterie|bureau|office|consommable/i, category: 'supplies', account: /fourniture|office|papeterie|supplies|consommable|stationery/i },
  { pattern: /loyer|rent|bail/i, category: 'rent', account: /loyer|rent|bail|lease/i },
  { pattern: /carburant|fuel|essence|diesel|gasoil/i, category: 'fuel', account: /carburant|fuel|essence|pétrole|petrol|diesel/i },
  { pattern: /t[ée]l[ée]phone|internet|mobile|communication/i, category: 'telecom', account: /t[ée]l[ée]phone|internet|communication|telecom/i },
  { pattern: /[ée]lectricit[ée]|eau|utilit|utilities/i, category: 'utilities', account: /[ée]lectricit|water|eau|utilit/i },
  { pattern: /honoraire|audit|conseil|consult|avocat|legal/i, category: 'professional_fees', account: /honoraire|professional|conseil|legal|audit/i },
  { pattern: /banque|bank|frais bancaire/i, category: 'bank_charges', account: /banque|bank|frais bancaire|charges bancaires/i },
  { pattern: /assurance|insurance/i, category: 'insurance', account: /assurance|insurance/i },
  { pattern: /salaire|salary|paie|payroll|wage/i, category: 'payroll', account: /salaire|salary|paie|payroll|wage/i },
  { pattern: /d[ée]placement|transport|voyage|travel/i, category: 'travel', account: /d[ée]placement|transport|voyage|travel/i },
  { pattern: /publicit|marketing|annonce|advert/i, category: 'marketing', account: /publicit|marketing|annonce|advert/i },
  { pattern: /entretien|r[ée]paration|maintenance|repair/i, category: 'maintenance', account: /entretien|r[ée]paration|maintenance|repair/i },
];

/** Reads the `[COMPTES AUTORISÉS]` block of a prompt: `code|nom|type` per line. */
export function parseAccountBlock(prompt: string): SimulatedAccount[] {
  const block = /\[COMPTES AUTORIS[ÉE]S\]([\s\S]*?)\[\/COMPTES AUTORIS[ÉE]S\]/i.exec(prompt);
  if (!block?.[1]) return [];
  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
    .map((line) => {
      const [code = '', name = '', type = ''] = line.split('|').map((p) => p.trim());
      return { code, name, type };
    })
    .filter((a) => /^[0-9A-Za-z._-]+$/.test(a.code) && a.name !== '');
}

export function categoryForDescription(description: string): string {
  return KEYWORDS.find((k) => k.pattern.test(description))?.category ?? 'uncategorised';
}

/**
 * Picks an account from the *real* chart of accounts: keyword match first,
 * then the first expense account, then the first account at all. A code that is
 * not in the list can never be returned.
 */
export function chooseAccount(description: string, accounts: SimulatedAccount[]): AccountMatch | null {
  if (accounts.length === 0) return null;

  const keyword = KEYWORDS.find((k) => k.pattern.test(description));
  if (keyword) {
    const exact = accounts.find((a) => keyword.account.test(a.name));
    if (exact) return { ...exact, matched: true, score: 0.9 };
  }

  // Token overlap on the account name (accent-insensitive, 4+ letters).
  const words = normalise(description)
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  let best: AccountMatch | null = null;
  for (const account of accounts) {
    const name = normalise(account.name);
    const hits = words.filter((w) => name.includes(w)).length;
    if (hits > 0) {
      const score = Math.min(0.85, 0.4 + hits * 0.15);
      if (!best || score > best.score) best = { ...account, matched: true, score };
    }
  }
  if (best) return best;

  const expense = accounts.find((a) => a.type === 'expense');
  const fallback = expense ?? accounts[0]!;
  return { ...fallback, matched: false, score: 0.2 };
}

export function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reusable keyword for a learned rule: the two most significant words. */
export function ruleKeyword(description: string): string {
  const words = normalise(description).split(' ').filter((w) => w.length >= 3);
  return words.slice(0, 3).join(' ').slice(0, 60);
}
