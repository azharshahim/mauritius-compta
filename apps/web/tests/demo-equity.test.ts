/** Mission 19 — browser demo for equity, closing and allocation (fictitious). */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

function login() {
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies').companies;
  const company = companies.find((c) => /Island Trading/i.test(c.name))!;
  const base = `/companies/${company.id}`;
  const accounts = call<{ accounts: any[] }>('GET', `${base}/accounts`).accounts;
  const journals = call<{ journals: any[] }>('GET', `${base}/journals`).journals;
  return { company, base, accounts, journals };
}
const account = (accounts: any[], code: string) => accounts.find((a) => a.code === code)!;
const journal = (journals: any[], code: string) => journals.find((j) => j.code === code)!;

describe('démo capitaux propres & clôture — simulation navigateur', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
  });

  it('présente un historique de deux exercices clôturés et un état rapproché', () => {
    const { base } = login();
    const overview = call<any>('GET', `${base}/equity/overview?from=2023-07-01&to=2026-06-30`);
    expect(overview.closings).toHaveLength(2);
    expect(overview.closings.every((c: any) => c.status === 'POSTED')).toBe(true);
    expect(overview.closings.some((c: any) => Number(c.resultAmount) < 0)).toBe(true);
    expect(overview.closings.some((c: any) => Number(c.resultAmount) > 0)).toBe(true);
    expect(overview.movements).toHaveLength(2);
    expect(overview.movements.filter((m: any) => m.status === 'DRAFT')).toHaveLength(1);
    expect(overview.statement.reconciliation.balanced).toBe(true);
    expect(Number(overview.statement.reconciliation.difference)).toBe(0);
    expect(overview.statement.note).toMatch(/No dividend/i);
    expect(overview.statement.demo).toBe(true);
  });

  it('exige un justificatif, une approbation et une période ouverte avant de comptabiliser', () => {
    const { base, accounts, journals } = login();
    const movement = call<any>('POST', `${base}/equity/movements`, {
      movementDate: '2025-12-10',
      category: 'dividend',
      direction: 'decrease',
      amount: '5000.00',
      equityAccountId: account(accounts, '3100').id,
      counterpartAccountId: account(accounts, '1100').id,
      journalId: journal(journals, 'OD').id,
      description: 'Distribution fictive décidée en assemblée',
      documentRef: 'PV-DIV-2025-001',
    }).movement;
    expect(movement.movementNo).toBe('EQ-2025-0001');
    expect(movement.status).toBe('DRAFT');

    expect(() =>
      call('POST', `${base}/equity/movements`, {
        movementDate: '2025-12-11', category: 'dividend', direction: 'decrease', amount: '10.00',
        equityAccountId: account(accounts, '3100').id, counterpartAccountId: account(accounts, '1100').id,
        journalId: journal(journals, 'OD').id, description: 'Doublon fictif', documentRef: 'PV-DIV-2025-001',
      }),
    ).toThrow(/déjà utilisé/);

    expect(() => call('POST', `${base}/equity/movements/${movement.id}/approve`, { confirm: true, note: 'court' }))
      .toThrow();
    const approved = call<any>('POST', `${base}/equity/movements/${movement.id}/approve`, {
      confirm: true, note: 'Approbation fictive sur la base du PV de démonstration.',
    }).movement;
    expect(approved.status).toBe('APPROVED');
    const posted = call<any>('POST', `${base}/equity/movements/${movement.id}/post`);
    expect(posted.movement.status).toBe('POSTED');
    expect(posted.entry.source).toBe('equity');
    expect(posted.entry.status).toBe('posted');
    expect(() => call('POST', `${base}/equity/movements/${movement.id}/post`)).toThrow(/immuable|déjà/i);

    const drafts = call<any>('GET', `${base}/equity/movements`).movements;
    const draft = drafts.find((m: any) => m.status === 'DRAFT');
    expect(() => call('POST', `${base}/equity/movements/${draft.id}/post`)).toThrow(/Approbation/);
  });

  it('bloque la clôture sur un brouillon puis la verrouille après comptabilisation', () => {
    const { base, accounts, journals } = login();
    const periods = call<any>('GET', `${base}/equity/overview`).periods;
    const period = periods.find((p: any) => p.start_date === '2025-07-01' && p.status === 'open');
    const prepared = call<any>('POST', `${base}/equity/closings`, {
      periodId: period.id,
      journalId: journal(journals, 'OD').id,
      resultAccountId: account(accounts, '3100').id,
    }).closing;
    expect(prepared.status).toBe('BLOCKED');
    expect(prepared.blockers.map((b: any) => b.code)).toContain('DRAFT_ENTRIES_PRESENT');
    expect(() =>
      call('POST', `${base}/equity/closings/${prepared.id}/approve`, {
        confirm: true, note: 'Approbation fictive malgré les brouillons.',
      }),
    ).toThrow(/bloquant|Contrôles/i);

    const draftEntry = call<any>('GET', `${base}/entries?status=draft`).entries
      .find((e: any) => e.status === 'draft');
    call('DELETE', `${base}/entries/${draftEntry.id}`);

    const refreshed = call<any>('POST', `${base}/equity/closings`, {
      periodId: period.id, journalId: journal(journals, 'OD').id, resultAccountId: account(accounts, '3100').id,
    }).closing;
    expect(refreshed.status).toBe('REVIEW_REQUIRED');
    expect(refreshed.blockers).toHaveLength(0);
    expect(Number(refreshed.resultAmount)).toBeGreaterThan(0);

    call('POST', `${base}/entries`, {
      journalId: journal(journals, 'OD').id,
      entryDate: '2026-01-15',
      reference: 'FICT-CORR-01',
      description: 'Correction fictive après préparation',
      status: 'posted',
      lines: [
        { accountId: account(accounts, '1100').id, debit: '100.00' },
        { accountId: account(accounts, '4000').id, credit: '100.00' },
      ],
    });
    expect(() =>
      call('POST', `${base}/equity/closings/${refreshed.id}/approve`, {
        confirm: true, note: 'Approbation fictive de démonstration après correction.',
      }),
    ).toThrow(/préparez|changé/i);

    const current = call<any>('POST', `${base}/equity/closings`, {
      periodId: period.id, journalId: journal(journals, 'OD').id, resultAccountId: account(accounts, '3100').id,
    }).closing;
    call('POST', `${base}/equity/closings/${current.id}/approve`, {
      confirm: true, note: 'Clôture fictive approuvée après contrôle humain.',
    });
    const posted = call<any>('POST', `${base}/equity/closings/${current.id}/post`);
    expect(posted.closing.status).toBe('POSTED');
    expect(posted.entry.source).toBe('closing');
    expect(posted.closing.nextPeriodId).toBeTruthy();

    const periodsAfter = call<any>('GET', `${base}/equity/overview`).periods;
    expect(periodsAfter.find((p: any) => p.id === period.id).status).toBe('closed');
    expect(() =>
      call('POST', `${base}/entries`, {
        journalId: journal(journals, 'OD').id,
        entryDate: '2026-02-01',
        description: 'Écriture fictive après clôture',
        status: 'posted',
        lines: [
          { accountId: account(accounts, '1100').id, debit: '5.00' },
          { accountId: account(accounts, '4000').id, credit: '5.00' },
        ],
      }),
    ).toThrow(/clôturée|Aucune période ouverte/);
    expect(() => call('POST', `${base}/equity/closings/${current.id}/post`)).toThrow(/déjà comptabilisée/i);
  });

  it('affecte le résultat uniquement par une décision documentée et exacte', () => {
    const { base, accounts, journals } = login();
    const periods = call<any>('GET', `${base}/equity/overview`).periods;
    const period = periods.find((p: any) => p.start_date === '2025-07-01' && p.status === 'open');
    const prepared = call<any>('POST', `${base}/equity/closings`, {
      periodId: period.id, journalId: journal(journals, 'OD').id, resultAccountId: account(accounts, '3100').id,
    }).closing;
    const draftEntry = call<any>('GET', `${base}/entries?status=draft`).entries.find((e: any) => e.status === 'draft');
    call('DELETE', `${base}/entries/${draftEntry.id}`);
    const refreshed = call<any>('POST', `${base}/equity/closings`, {
      periodId: period.id, journalId: journal(journals, 'OD').id, resultAccountId: account(accounts, '3100').id,
    }).closing;
    call('POST', `${base}/equity/closings/${refreshed.id}/approve`, {
      confirm: true, note: 'Clôture fictive approuvée pour test de démonstration.',
    });
    call('POST', `${base}/equity/closings/${refreshed.id}/post`);
    const result = Number(prepared.resultAmount);

    const payload = (amount: number) => ({
      allocationDate: '2027-01-15',
      journalId: journal(journals, 'OD').id,
      documentRef: 'PV-AFF-2027-001',
      decisionDate: '2027-01-10',
      note: 'Affectation fictive de démonstration décidée en assemblée.',
      lines: [{ nature: 'reserves', accountId: account(accounts, '3200').id, amount: String(amount) }],
    });
    expect(() => call('PUT', `${base}/equity/closings/${refreshed.id}/allocation`, payload(result - 1)))
      .toThrow(/totaliser/i);
    const saved = call<any>('PUT', `${base}/equity/closings/${refreshed.id}/allocation`, payload(result));
    expect(saved.allocation.status).toBe('DRAFT');
    expect(saved.allocation.unallocatedAmount).toBe('0.0000');
    expect(() => call('POST', `${base}/equity/closings/${refreshed.id}/allocation/post`)).toThrow(/Approbation/);
    call('POST', `${base}/equity/closings/${refreshed.id}/allocation/approve`, {
      confirm: true, note: 'Affectation fictive approuvée pour la démonstration.',
    });
    const posted = call<any>('POST', `${base}/equity/closings/${refreshed.id}/allocation/post`);
    expect(posted.allocation.status).toBe('POSTED');
    expect(posted.entry.source).toBe('equity_allocation');
    expect(() => call('POST', `${base}/equity/closings/${refreshed.id}/allocation/post`))
      .toThrow(/déjà comptabilisée/i);

    const statement = call<any>('GET', `${base}/equity/statement?from=2026-07-01&to=2027-06-30`);
    expect(statement.reconciliation.balanced).toBe(true);
    expect(statement.rows.some((r: any) => r.code === '3200')).toBe(true);
  });
});
