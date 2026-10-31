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

// ---------------------------------------------------------------------------
// Full journal entry proposal (mission 6) - deterministic, offline, no cost.
// ---------------------------------------------------------------------------

function operationFromPrompt(prompt: string): string {
  const match = /OP[ÉE]RATION\s*:\s*(.+)/i.exec(prompt);
  return (match?.[1] ?? '').trim().slice(0, 300);
}

function promptBlock(prompt: string, tag: string): string[] {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'i');
  const block = re.exec(prompt);
  if (!block?.[1]) return [];
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseRoleCodes(prompt: string): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const line of promptBlock(prompt, 'COMPTES RÔLES')) {
    const [role, code] = line.split('=').map((p) => p.trim());
    if (role && code) roles[role] = code;
  }
  return roles;
}

function parseJournalCodes(prompt: string): string[] {
  return promptBlock(prompt, 'JOURNAUX AUTORISÉS')
    .filter((l) => l.includes('|'))
    .map((l) => l.split('|')[0]!.trim())
    .filter(Boolean);
}

function parsePromptAmount(prompt: string): string | null {
  const match = /MONTANT INDIQU[ÉE]\s*:\s*([0-9]+(?:\.[0-9]{1,4})?)/i.exec(prompt);
  return match?.[1] ?? null;
}

function parsePromptDate(prompt: string): string | null {
  const match = /DATE COMPTABLE PAR D[ÉE]FAUT\s*:\s*(\d{4}-\d{2}-\d{2})/i.exec(prompt);
  return match?.[1] ?? null;
}

function parsePromptCurrency(prompt: string): string | null {
  const match = /DEVISE\s*:\s*([A-Z]{3})/i.exec(prompt);
  return match?.[1]?.toUpperCase() ?? null;
}

/**
 * Builds a balanced two-line entry from keywords, the supplied chart and the
 * role codes of the prompt. No rate, no tax and no amount is ever invented: the
 * amount must be present in the prompt, otherwise the answer is explicitly
 * incomplete.
 */
export function simulateJournalProposal(prompt: string): {
  journalCode: string | null;
  entryDate: string | null;
  description: string;
  currency: string | null;
  lines: { accountCode: string; debit: string | null; credit: string | null; description: string }[];
  rationale: string;
  confidence: number;
  missing: string[];
  warnings: string[];
} {
  const description = operationFromPrompt(prompt) || 'Opération';
  const accounts = parseAccountBlock(prompt);
  const roles = parseRoleCodes(prompt);
  const journals = parseJournalCodes(prompt);
  const amount = parsePromptAmount(prompt);
  const currency = parsePromptCurrency(prompt);
  const entryDate = parsePromptDate(prompt);
  const warnings: string[] = [];
  const missing: string[] = [];

  const pickJournal = (preferred: string): string | null =>
    journals.find((j) => j.toUpperCase() === preferred) ?? journals[0] ?? null;

  const expense =
    accounts.find((a) => a.type === 'expense' && /frais bancaire|charges bancaires|bank charge|commission/i.test(a.name)) ??
    chooseAccount(description, accounts) ??
    accounts.find((a) => a.type === 'expense') ??
    null;

  if (!amount) missing.push('Aucun montant fourni : l’écriture ne peut pas être chiffrée.');
  if (!currency) missing.push('Aucune devise fournie.');
  if (missing.length > 0 || !amount) {
    return {
      journalCode: null,
      entryDate,
      description,
      currency,
      lines: [],
      rationale: 'Données insuffisantes : aucun montant ou aucune devise fiable fourni.',
      confidence: 0.1,
      missing,
      warnings,
    };
  }

  const text = description.toLowerCase();
  const client = roles['client'] ?? null;
  const fournisseur = roles['fournisseur'] ?? null;
  const banque = roles['banque'] ?? null;
  const produits = roles['produits'] ?? null;
  const vatMention = /tva|vat|taxe/i.test(description);
  if (vatMention) {
    warnings.push(
      'TVA mentionnée : aucun taux n’est configuré ni fourni au simulateur. Aucun montant de taxe n’est calculé.',
    );
    missing.push('Taux de TVA vérifié (configuration absente) et montant de taxe à confirmer.');
  }

  let journalCode: string | null = null;
  let debitCode: string | null = null;
  let creditCode: string | null = null;
  let rationale = '';

  if (/avoir/.test(text) && produits && client) {
    journalCode = pickJournal('SAL');
    debitCode = produits;
    creditCode = client;
    rationale = 'Avoir : annulation de produit au débit et réduction de la créance client au crédit.';
  } else if (/encaissement|r[èe]glement client|re[çc]u client|payment received|received from customer/.test(text) && banque && client) {
    journalCode = pickJournal('BQ');
    debitCode = banque;
    creditCode = client;
    rationale = 'Encaissement client : banque au débit, créance client au crédit.';
  } else if (/frais bancaire|bank charge|commission|agios/.test(text) && banque) {
    journalCode = pickJournal('BQ');
    debitCode = expense?.code ?? null;
    creditCode = banque;
    rationale = 'Frais bancaires : charge au débit, compte bancaire au crédit.';
    if (expense) warnings.push(`Compte de charge ${expense.code} proposé par défaut : à vérifier par un humain.`);
  } else if (/facture client|vente|prestation|invoice to customer|sales invoice|client facture/.test(text) && client && produits) {
    journalCode = pickJournal('SAL');
    debitCode = client;
    creditCode = produits;
    rationale = 'Facture client : créance au débit, produit au crédit.';
  } else if (/pr[ée]l[èe]vement|prelevement|virement|standing order|direct debit|paiement fournisseur/.test(text) && expense && banque) {
    journalCode = pickJournal('BQ');
    debitCode = expense.code;
    creditCode = banque;
    rationale = 'Prélèvement bancaire : charge au débit, banque au crédit.';
  } else if (expense) {
    journalCode = pickJournal(/fournisseur|achat|facture/.test(text) ? 'PUR' : 'PUR');
    debitCode = expense.code;
    creditCode = /pay[ée]|r[ée]gl[ée]|paid|cash|caisse/.test(text) && banque ? banque : fournisseur;
    rationale = 'Achat / charge : compte de charge au débit, dette fournisseur (ou banque si réglé) au crédit.';
  }

  if (!journalCode || !debitCode || !creditCode) {
    return {
      journalCode: null,
      entryDate,
      description,
      currency,
      lines: [],
      rationale: 'Les comptes nécessaires (charge, tiers, banque) sont absents du plan comptable fourni.',
      confidence: 0.1,
      missing: ['Comptes requis absents du plan comptable : intervention humaine nécessaire.'],
      warnings,
    };
  }

  if (debitCode === creditCode) {
    return {
      journalCode: null,
      entryDate,
      description,
      currency,
      lines: [],
      rationale: 'La même contrepartie serait utilisée au débit et au crédit : proposition refusée.',
      confidence: 0.1,
      missing: ['Contrepartie distincte requise.'],
      warnings,
    };
  }

  return {
    journalCode,
    entryDate,
    description,
    currency,
    lines: [
      { accountCode: debitCode, debit: amount, credit: null, description },
      { accountCode: creditCode, debit: null, credit: amount, description },
    ],
    rationale,
    confidence: 0.72,
    missing,
    warnings,
  };
}
