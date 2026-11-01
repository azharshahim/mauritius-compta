import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { dictionaries, translateError } from '../src/i18n';
import { GLOSSARY } from '../src/glossary';

const fr = dictionaries.fr;
const en = dictionaries.en;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('FR/EN quality gate', () => {
  it('has exactly the same keys in French and English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    expect(Object.keys(fr).length).toBeGreaterThan(1500);
  });

  it('keeps one canonical pair per glossary concept', () => {
    const pairs: Record<string, [string, string, string, string]> = {
      chartOfAccounts: ['nav.accounts', GLOSSARY.chartOfAccounts.fr, GLOSSARY.chartOfAccounts.en, 'accounts.title'],
      generalLedger: ['nav.ledger', GLOSSARY.generalLedger.fr, GLOSSARY.generalLedger.en, 'ledger.title'],
      trialBalance: ['nav.trialBalance', GLOSSARY.trialBalance.fr, GLOSSARY.trialBalance.en, 'tb.title'],
      statementOfProfitOrLoss: ['st.pl', GLOSSARY.statementOfProfitOrLoss.fr, GLOSSARY.statementOfProfitOrLoss.en, 'st.pl'],
      fixedAssets: ['nav.accounting.assets', GLOSSARY.fixedAssets.fr, GLOSSARY.fixedAssets.en, 'chart.role.fixed_asset'],
      bankReconciliation: ['mcb.openBank', GLOSSARY.bankReconciliation.fr, GLOSSARY.bankReconciliation.en, 'mcb.openBank'],
      payslip: ['nav.payroll.payslips', GLOSSARY.payslip.fr, GLOSSARY.payslip.en, 'payroll.payslip.title'],
    };
    for (const [name, [key, french, english, secondKey]] of Object.entries(pairs)) {
      expect(fr[key], `${name}: ${key}`).toBe(french);
      expect(en[key], `${name}: ${key}`).toBe(english);
      expect(fr[secondKey], `${name}: ${secondKey}`).toBe(french);
    }
    expect(fr['nav.accounting.accruals']).toBe(GLOSSARY.accrualsAndPrepayments.fr);
    expect(en['nav.accounting.accruals']).toBe(GLOSSARY.accrualsAndPrepayments.en);
  });

  it('does not leak the other language into visible labels', () => {
    for (const [key, value] of Object.entries(fr)) {
      expect(value, `${key}`).not.toMatch(/Configuration required|\/ Cancel\b|Please |\bSettings\b|\bDashboard\b/);
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value, `${key}`).not.toMatch(/Annuler|Paramétrage requis|Enregistrer|Brouillon|Fournisseur|Société/);
    }
  });

  it('translates known server error codes in both languages', () => {
    const tFr = (key: string) => dictionaries.fr[key] ?? key;
    const tEn = (key: string) => dictionaries.en[key] ?? key;
    const errorKeys = Object.keys(fr).filter((key) => key.startsWith('error.'));
    expect(errorKeys.length).toBeGreaterThanOrEqual(60);
    for (const key of errorKeys) {
      expect(en[key], key).toBeTruthy();
      expect(en[key], key).not.toBe(key);
    }
    expect(translateError('DOCUMENT_TOO_LARGE', 'server text', tFr)).toContain('8 Mo');
    expect(translateError('DOCUMENT_TOO_LARGE', 'server text', tEn)).toContain('8 MB');
    expect(translateError('UNMAPPED_CODE', 'localised server text', tFr)).toBe('localised server text');
  });

  it('resolves every literal translation key used by the web source', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(path.resolve('src'))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
        if (!(match[1]! in fr) || !(match[1]! in en)) missing.push(`${match[1]} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
