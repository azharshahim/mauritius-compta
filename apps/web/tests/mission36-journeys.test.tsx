/**
 * Mission 36 — eight accountant journeys, run in French and in English.
 *
 * The tests use the fictional in-browser demo only (`fetch` is stubbed and
 * asserted unused). They exercise existing screens and existing calculation
 * rules; no accounting, tax, payroll or closing rule is redefined here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';
import { navLink } from './nav';

type Locale = 'fr' | 'en';
const LOCALES: Locale[] = ['fr', 'en'];

function renderApp() {
  window.location.hash = '#/';
  return render(
    <I18nProvider>
      <SessionProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

async function login() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter|Sign in/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet|Cabinet dashboard/i });
}

function t(locale: Locale, fr: RegExp, en: RegExp): RegExp {
  return locale === 'fr' ? fr : en;
}

describe.each(LOCALES)('mission 36 — parcours comptable (%s)', (locale) => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    localStorage.setItem('mc.locale', locale);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('1. dossier, plan comptable et soldes d’ouverture', async () => {
    await login();
    expect(screen.getByLabelText(t(locale, /^Société$/, /^Company$/))).toBeTruthy();

    fireEvent.click(navLink(t(locale, /^Plan comptable$/, /^Chart of Accounts$/)));
    await screen.findByRole('heading', { name: t(locale, /^Plan comptable$/, /^Chart of Accounts$/) });
    expect((await screen.findAllByText(/PENDING PROFESSIONAL VALIDATION/)).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(navLink(t(locale, /^Soldes d’ouverture$/, /^Opening Balances$/)));
    const tab = await screen.findByRole('tab', { name: t(locale, /^Soldes d’ouverture$/, /^Opening balances$/) });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText(t(locale, /Aperçu des soldes d’ouverture/, /Opening-balance overview/))).toBeTruthy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('2. écriture → grand livre → balance', async () => {
    await login();
    fireEvent.click(navLink(t(locale, /^Écritures comptables$/, /^Journal Entries$/)));
    await screen.findByRole('heading', { name: t(locale, /^Écritures comptables$/, /^Journal Entries$/) });

    fireEvent.click(screen.getByRole('button', { name: t(locale, /Ajouter une écriture/, /Add entry/) }));
    const dialog = await screen.findByRole('dialog', { name: t(locale, /Nouvelle écriture/, /New entry/) });

    fireEvent.change(within(dialog).getByLabelText(t(locale, /^Référence$/, /^Reference$/)), {
      target: { value: 'M36-J2' },
    });
    fireEvent.change(within(dialog).getByLabelText(t(locale, /^Libellé$/, /^Description$/)), {
      target: { value: 'Écriture de parcours M36 (fictive)' },
    });

    const accounts = within(dialog).getAllByLabelText(t(locale, /^Compte$/, /^Account$/)) as HTMLSelectElement[];
    const first = Array.from(accounts[0]!.options).find((o) => o.value);
    const second = Array.from(accounts[1]!.options).find((o) => o.value && o.value !== first?.value);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    fireEvent.change(accounts[0]!, { target: { value: first!.value } });
    fireEvent.change(accounts[1]!, { target: { value: second!.value } });

    const debits = within(dialog).getAllByLabelText(t(locale, /^Débit$/, /^Debit$/)) as HTMLInputElement[];
    const credits = within(dialog).getAllByLabelText(t(locale, /^Crédit$/, /^Credit$/)) as HTMLInputElement[];
    fireEvent.change(debits[0]!, { target: { value: '1234.00' } });
    fireEvent.change(credits[1]!, { target: { value: '1234.00' } });

    const post = within(dialog).getByRole('button', {
      name: t(locale, /Enregistrer et valider/, /Save and post/),
    }) as HTMLButtonElement;
    await waitFor(() => expect(post.disabled).toBe(false));
    fireEvent.click(post);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t(locale, /Nouvelle écriture/, /New entry/) })).toBeNull());

    fireEvent.click(navLink(t(locale, /^Grand livre$/, /^General Ledger$/)));
    await screen.findByRole('heading', { name: t(locale, /^Grand livre$/, /^General Ledger$/) });
    fireEvent.change(screen.getByLabelText(t(locale, /^Du$/, /^From$/)), { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText(t(locale, /^Au$/, /^To$/)), { target: { value: '2030-12-31' } });
    expect((await screen.findAllByText('M36-J2')).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(navLink(t(locale, /^Balance générale$/, /^Trial Balance$/)));
    await screen.findByRole('heading', { name: t(locale, /^Balance générale$/, /^Trial Balance$/) });
    expect(await screen.findByText(t(locale, /Balance équilibrée/, /Trial balance is balanced/))).toBeTruthy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('3. facture client → proposition → écriture comptable', async () => {
    await login();
    fireEvent.click(navLink(t(locale, /^Factures clients$/, /^Sales Invoices$/)));
    await screen.findByRole('heading', { name: t(locale, /^Factures clients$/, /^Sales Invoices$/) });
    expect(await screen.findByText('FAC-DEMO-0002')).toBeTruthy();

    // The invoice is never posted by the billing screen: the accountant goes
    // through the existing proposal → human validation → posting path.
    fireEvent.click(navLink(t(locale, /^Écritures proposées$/, /^Proposed entries$/)));
    await screen.findByRole('heading', { name: t(locale, /^Écritures proposées$/, /^Proposed entries$/) });
    const fromInvoice = (await screen.findByLabelText(
      t(locale, /Proposer depuis une facture émise/, /Propose from an issued invoice/),
    )) as HTMLSelectElement;
    const option = Array.from(fromInvoice.options).find((o) => /FAC-DEMO-0002/.test(o.text));
    expect(option).toBeTruthy();
    fireEvent.change(fromInvoice, { target: { value: option!.value } });

    expect(await screen.findByText(t(locale, /Proposition créée/, /Proposal created/))).toBeTruthy();
    expect((await screen.findAllByText(t(locale, /^À vérifier$/, /^To review$/))).length).toBeGreaterThanOrEqual(1);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: t(locale, /^Valider$/, /^Validate$/) }));
    await waitFor(() =>
      expect(screen.getAllByText(t(locale, /Validée \(non comptabilisée\)/, /Validated \(not posted\)/)).length).toBeGreaterThanOrEqual(1),
    );
    fireEvent.click(screen.getByRole('button', { name: t(locale, /^Comptabiliser$/, /^Post to accounting$/) }));
    await waitFor(() =>
      expect(screen.getAllByText(t(locale, /Comptabilisée/, /^Posted$/)).length).toBeGreaterThanOrEqual(1),
    );

    fireEvent.click(navLink(t(locale, /^Factures clients$/, /^Sales Invoices$/)));
    await screen.findByRole('heading', { name: t(locale, /^Factures clients$/, /^Sales Invoices$/) });
    expect((await screen.findAllByText(t(locale, /^Comptabilisé$/, /^Posted$/))).length).toBeGreaterThanOrEqual(1);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('4. facture fournisseur → proposition → dettes fournisseurs', async () => {
    await login();
    fireEvent.click(navLink(t(locale, /^Tableau de bord Achats$/, /^Purchases dashboard$/)));
    await screen.findByRole('heading', { name: t(locale, /^Achats et dépenses$/, /^Purchases & Expenses$/) });
    fireEvent.click(screen.getByRole('tab', { name: t(locale, /^Factures fournisseurs$/, /^Bills$/) }));

    const numbers = await screen.findAllByText('FAC-DEMO-1001');
    const row = numbers[0]!.closest('tr')!;
    expect(row.textContent).toContain('FAC-DEMO-1001');
    fireEvent.click(within(row).getByRole('button', { name: t(locale, /^Proposition$/, /^Proposal$/) }));
    expect(await screen.findByText(t(locale, /Proposition préparée/, /Proposal prepared/))).toBeTruthy();

    fireEvent.click(navLink(t(locale, /^Comptes fournisseurs — balance âgée$/, /^Accounts Payable aging$/)));
    await screen.findByRole('heading', { name: t(locale, /Échéancier des dettes fournisseurs/, /Supplier debt aging/) });
    expect((await screen.findAllByText(/Atelier Rivière|Oceanic Supplies/)).length).toBeGreaterThanOrEqual(1);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('5. rapprochement bancaire et rapport', async () => {
    await login();
    fireEvent.click(navLink(t(locale, /^Rapprochement bancaire$/, /^Bank reconciliation$/)));
    await screen.findByRole('heading', { name: t(locale, /Banque & rapprochement/, /Bank & reconciliation/) });

    const transactions = await screen.findByRole('tab', { name: t(locale, /^Transactions$/, /^Transactions$/) });
    expect(transactions.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: t(locale, /^Rapport$/, /^Report$/) }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: t(locale, /^Rapport$/, /^Report$/) }).getAttribute('aria-selected')).toBe('true'),
    );
    expect((await screen.findAllByText(t(locale, /^Rapport$/, /^Report$/))).length).toBeGreaterThanOrEqual(1);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('6. bilan, compte de résultat et états financiers', async () => {
    await login();
    fireEvent.click(navLink(t(locale, /^Bilan$/, /^Balance Sheet$/)));
    await screen.findByRole('heading', { name: t(locale, /^Bilan$/, /^Balance Sheet$/) });
    expect(await screen.findByText(t(locale, /Non conforme IFRS/, /Not IFRS compliant/))).toBeTruthy();
    expect(await screen.findByText(t(locale, /^Total actif$/, /^Total assets$/))).toBeTruthy();

    fireEvent.click(navLink(t(locale, /^Compte de résultat$/, /^Profit & Loss$/)));
    await screen.findByRole('heading', { name: t(locale, /^Compte de résultat$/, /^Profit & Loss$/) });
    expect((await screen.findAllByText(t(locale, /^Produits$/, /^Revenue$/))).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(t(locale, /^Résultat de la période$/, /^Profit for the period$/))).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(navLink(t(locale, /^Tous les états financiers$/, /^All financial statements$/)));
    await screen.findByRole('heading', { name: t(locale, /^États financiers \(provisoires\)$/, /^Financial Statements \(provisional\)$/) });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('7. changement de dossier sans fuite de données', async () => {
    await login();
    fireEvent.click(navLink(t(locale, /^Écritures comptables$/, /^Journal Entries$/)));
    await screen.findByRole('heading', { name: t(locale, /^Écritures comptables$/, /^Journal Entries$/) });
    fireEvent.click(await screen.findByRole('button', { name: '›' }));
    expect((await screen.findAllByText(/FA-2025-001/)).length).toBeGreaterThanOrEqual(1);

    const select = screen.getByLabelText(t(locale, /^Société$/, /^Company$/)) as HTMLSelectElement;
    const other = Array.from(select.options).find((o) => /Case Noyale/.test(o.text));
    expect(other).toBeTruthy();
    fireEvent.change(select, { target: { value: other!.value } });
    await waitFor(() => expect(localStorage.getItem('mc.companyId')).toBe(other!.value));

    await waitFor(() =>
      expect(screen.getByText(t(locale, /Aucune écriture validée sur la période/, /No posted entries/))).toBeTruthy(),
    );
    expect(screen.queryAllByText(/FA-2025-001/)).toHaveLength(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('8. immobilisations, stocks et paie depuis la navigation', async () => {
    await login();
    fireEvent.click(navLink(t(locale, /^Immobilisations$/, /^Fixed Assets$/)));
    await screen.findByRole('heading', { name: t(locale, /^Immobilisations et amortissements$/, /^Fixed assets and depreciation$/) });

    fireEvent.click(navLink(t(locale, /^Stocks$/, /^Inventory$/)));
    await screen.findByRole('heading', { name: t(locale, /^Stocks$/, /^Inventory$/) });

    fireEvent.click(navLink(t(locale, /^Tableau de bord Paie$/, /^Payroll dashboard$/)));
    await screen.findByRole('heading', { name: t(locale, /^Paie & RH$/, /^Payroll & HR$/) });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
