/**
 * Mission 42.1 — new accounting-control screens and late-allocation paths.
 *
 * Everything runs against the embedded fictional demo backend: the fetch spy
 * must never be called, so the test also proves the demo does not hit a server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { demoRequest, resetDemo } from '../src/demo';

function renderApp(hash = '#/') {
  window.location.hash = hash;
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
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
}

describe('mission 42.1 — accounting controls and late allocations', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the subledger reconciliation and the VAT control from the accounting navigation', async () => {
    await login();
    window.location.hash = '#/accounting/controls';
    await screen.findByRole('heading', { name: /Contrôles comptables/i });

    expect(screen.getByRole('button', { name: /Rapprochement clients \/ fournisseurs/i })).toBeTruthy();
    expect(await screen.findByText(/Clients \(comptes collectifs\)/i)).toBeTruthy();
    expect(screen.getByText(/Fournisseurs \(comptes collectifs\)/i)).toBeTruthy();
    expect(screen.getAllByText(/aucun écart n’est forcé à zéro/i).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Contrôle TVA$/i }));
    expect(await screen.findByText(/Ce n’est pas une déclaration officielle MRA/i)).toBeTruthy();
    expect(screen.getByText(/Aucun taux, seuil ni case fiscale n’est inventé/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allocates a receipt later and cancels the allocation with a reason', async () => {
    await login();

    const companies = demoRequest<{ companies: { id: string }[] }>('GET', '/companies').companies;
    const companyId = companies[0]!.id;
    const customers = demoRequest<{ customers: any[] }>(
      'GET',
      `/companies/${companyId}/billing/customers`,
    ).customers;
    const documents = demoRequest<{ documents: any[] }>(
      'GET',
      `/companies/${companyId}/billing/documents?kind=invoice`,
    ).documents;
    const invoice = documents.find(
      (document) => document.status === 'issued' || document.status === 'partially_paid',
    );
    expect(invoice).toBeTruthy();
    const customer = customers.find((candidate) => candidate.id === invoice.customerId);
    expect(customer).toBeTruthy();

    const created = demoRequest<{ payment: any }>('POST', `/companies/${companyId}/billing/payments`, {
      customerId: customer.id,
      paymentDate: '2026-02-01',
      amount: '1000.00',
      currency: invoice.currency,
      method: 'bank_transfer',
    });
    expect(created.payment.unallocatedAmount).toBe('1000.0000');

    window.location.hash = '#/billing/payments';
    await screen.findByRole('heading', { name: /Encaissements/i });
    const row = (await screen.findByText(created.payment.number)).closest('tr');
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^Affecter$/ }));
    await screen.findByText(/Affectation tardive d’un encaissement/i);

    fireEvent.change(screen.getByLabelText(/Facture à affecter/i), {
      target: { value: invoice.id },
    });
    fireEvent.change(screen.getByLabelText(/^Montant$/i), { target: { value: '250.00' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmer l’affectation/i }));

    expect((await screen.findAllByText(/Affectation enregistrée\./i)).length).toBeGreaterThan(0);

    const paymentRow = (await screen.findByText(created.payment.number)).closest('tr');
    fireEvent.click(within(paymentRow as HTMLElement).getByRole('button', { name: /^Annuler l’affectation$/i }));
    await screen.findByText(/Annulation d’une affectation/i);
    fireEvent.change(screen.getByLabelText(/Motif de l’annulation/i), {
      target: { value: 'Erreur d’affectation fictive' },
    });
    const confirmCancel = screen.getAllByRole('button', { name: /^Annuler l’affectation$/i });
    fireEvent.click(confirmCancel[confirmCancel.length - 1]!);

    expect(await screen.findByText(/Affectation annulée ; le montant redevient non affecté/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    const after = demoRequest<{ payments: any[] }>('GET', `/companies/${companyId}/billing/payments`).payments;
    const payment = after.find((candidate) => candidate.id === created.payment.id);
    expect(payment.allocations[0].cancelledAt).toBeTruthy();
    expect(payment.allocations[0].allocatedDate).toBeTruthy();

    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
  });

  it('shows the fixed-asset action on a validated supplier invoice', async () => {
    await login();
    window.location.hash = '#/accounting/purchases?tab=invoices';
    await screen.findByRole('heading', { name: /Achats et dépenses/i });
    expect((await screen.findAllByText(/FAC-DEMO-1001/i)).length).toBeGreaterThan(0);

    const buttons = await screen.findAllByRole('button', { name: /^Immobilisation$/i });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]!);
    await screen.findByText(/Lignes d’achat et immobilisations/i);
    expect(screen.getByText(/Seules les lignes imputées à un compte d’immobilisation sont admissibles/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
