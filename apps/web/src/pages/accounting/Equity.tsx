import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, toScaled4 } from '../../format';

interface Account { id: string; code: string; name: string; type: string; is_active: boolean }
interface Journal { id: string; code: string; name: string; is_active: boolean }
interface Period { id: string; name: string; start_date: string; end_date: string; status: 'open' | 'closed' }
interface Check { code: string; severity: 'ok' | 'warning' | 'block'; messageEn: string; messageFr: string }
interface Movement {
  id: string; movementNo: string; movementDate: string; category: string; direction: string; amount: string;
  equityAccount: Account; counterpartAccount: Account; journal: Journal; description: string; documentRef: string;
  status: string; entryNo: string | null; approvalNote: string | null;
}
interface ClosingLine { accountId: string; code: string; name: string; description: string; debit: string; credit: string }
interface Closing {
  id: string; sourcePeriodId: string; sourcePeriodName: string; sourceStart: string; sourceEnd: string; version: number;
  journal: Journal; resultAccount: Account; nextStartDate: string; nextEndDate: string; nextPeriodId: string | null;
  resultAmount: string; status: string; checks: Check[]; blockers: Check[]; warnings: Check[]; lines: ClosingLine[];
  decisionNote: string | null; rejectionReason: string | null; closingEntryNo: string | null; sourceFingerprint: string;
}
interface AllocationLine { id?: string; nature: string; amount: string; account: Account }
interface Allocation {
  id: string; closingId: string; allocationDate: string; decisionDate: string; documentRef: string; note: string;
  journal: Journal; resultAmount: string; allocatedAmount: string; unallocatedAmount: string; status: string;
  approvalNote: string | null; entryNo: string | null; lines: AllocationLine[];
}
interface StatementRow {
  accountId: string; code: string; name: string; opening: string; increases: string; decreases: string;
  movement: string; closing: string; trialBalanceClosing: string; difference: string;
}
interface Statement {
  from: string; to: string; currency: string; rows: StatementRow[]; unappropriatedResult: string;
  totals: { opening: string; increases: string; decreases: string; closing: string; result: string; equityWithResult: string };
  reconciliation: { assets: string; liabilities: string; equityAccounts: string; unappropriatedResult: string; difference: string; balanced: boolean; trialBalanceBalanced: boolean };
  closedThrough: string | null; note: string; noteFr: string;
}
interface Overview {
  statement: Statement; movements: Movement[]; closings: Closing[]; accounts: Account[]; journals: Journal[]; periods: Period[];
}

type Tab = 'statement' | 'register' | 'closing' | 'allocation';
const NATURES = ['retained_earnings', 'reserves', 'dividends', 'other'] as const;
const CATEGORIES = ['capital', 'contribution', 'reserve', 'retained_earnings', 'dividend', 'adjustment'] as const;

const statusKind = (status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' => {
  if (['POSTED'].includes(status)) return 'success';
  if (['APPROVED', 'REVIEW_REQUIRED'].includes(status)) return 'info';
  if (['BLOCKED', 'REJECTED', 'CANCELLED'].includes(status)) return 'danger';
  return 'neutral';
};

function defaultNextEnd(start: string): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function defaultNextStart(end: string): string {
  return new Date(Date.parse(`${end}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
function exact(value: string | number): bigint {
  return toScaled4(value as string) ?? 0n;
}

export default function EquityPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [tab, setTab] = useState<Tab>('statement');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync<Overview | null>(
    () => (company ? api.get<Overview>(`/companies/${company.id}/equity/overview${qs({ from, to })}`) : Promise.resolve(null)),
    [company?.id, from, to],
  );

  const equityAccounts = useMemo(() => (data?.accounts ?? []).filter((a) => a.type === 'equity'), [data]);
  const activeAccounts = useMemo(() => (data?.accounts ?? []).filter((a) => a.is_active), [data]);
  const activeJournals = useMemo(() => (data?.journals ?? []).filter((j) => j.is_active), [data]);
  const openPeriods = useMemo(
    () => (data?.periods ?? []).filter((p) => p.status === 'open').sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [data],
  );

  // ------------------------------------------------------------- register
  const [movement, setMovement] = useState({
    movementDate: new Date().toISOString().slice(0, 10),
    category: 'contribution',
    direction: 'increase',
    amount: '',
    equityAccountId: '',
    counterpartAccountId: '',
    journalId: '',
    description: '',
    documentRef: '',
  });
  useEffect(() => {
    if (!data) return;
    setMovement((current) => ({
      ...current,
      equityAccountId: current.equityAccountId || equityAccounts[0]?.id || '',
      counterpartAccountId: current.counterpartAccountId || activeAccounts.find((a) => a.type === 'asset')?.id || '',
      journalId: current.journalId || activeJournals.find((j) => j.code === 'OD')?.id || activeJournals[0]?.id || '',
    }));
  }, [data, equityAccounts, activeAccounts, activeJournals]);

  const [decision, setDecision] = useState<{ kind: 'movement' | 'closing' | 'allocation'; id: string; title: string } | null>(null);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  // -------------------------------------------------------------- closing
  const [closingForm, setClosingForm] = useState({
    periodId: '', journalId: '', resultAccountId: '', nextStartDate: '', nextEndDate: '',
  });
  useEffect(() => {
    if (!data) return;
    setClosingForm((current) => {
      const period = current.periodId ? openPeriods.find((p) => p.id === current.periodId) : openPeriods[0];
      return {
        periodId: current.periodId || period?.id || '',
        journalId: current.journalId || activeJournals.find((j) => j.code === 'OD')?.id || activeJournals[0]?.id || '',
        resultAccountId: current.resultAccountId || equityAccounts.find((a) => a.code === '3100')?.id || equityAccounts[0]?.id || '',
        nextStartDate: current.nextStartDate || (period ? defaultNextStart(period.end_date) : ''),
        nextEndDate: current.nextEndDate || (period ? defaultNextEnd(defaultNextStart(period.end_date)) : ''),
      };
    });
  }, [data, openPeriods, activeJournals, equityAccounts]);

  const [preview, setPreview] = useState<Closing | null>(null);

  // ----------------------------------------------------------- allocation
  const [allocationClosingId, setAllocationClosingId] = useState('');
  const postedClosings = useMemo(
    () => (data?.closings ?? []).filter((c) => c.status === 'POSTED' && exact(c.resultAmount) !== 0n),
    [data],
  );
  const allocatableClosing = postedClosings.find((c) => c.id === allocationClosingId) ?? null;
  const [allocation, setAllocation] = useState<{
    allocationDate: string; decisionDate: string; documentRef: string; note: string; journalId: string;
    lines: { nature: string; accountId: string; amount: string }[];
  }>({ allocationDate: '', decisionDate: '', documentRef: '', note: '', journalId: '', lines: [] });

  const { data: existingAllocation, reload: reloadAllocation } = useAsync<Allocation | null>(
    () =>
      company && allocationClosingId
        ? api
            .get<{ allocation: Allocation | null }>(`/companies/${company.id}/equity/closings/${allocationClosingId}/allocation`)
            .then((r) => r.allocation)
        : Promise.resolve(null),
    [company?.id, allocationClosingId],
  );
  useEffect(() => {
    if (!allocatableClosing) return;
    const today = new Date().toISOString().slice(0, 10);
    setAllocation((current) => ({
      allocationDate: current.allocationDate || today,
      decisionDate: current.decisionDate || today,
      documentRef: current.documentRef,
      note: current.note,
      journalId: current.journalId || activeJournals.find((j) => j.code === 'OD')?.id || activeJournals[0]?.id || '',
      lines: current.lines,
    }));
  }, [allocatableClosing, activeJournals]);
  useEffect(() => {
    if (!existingAllocation) return;
    setAllocation({
      allocationDate: existingAllocation.allocationDate,
      decisionDate: existingAllocation.decisionDate,
      documentRef: existingAllocation.documentRef,
      note: existingAllocation.note,
      journalId: existingAllocation.journal.id,
      lines: existingAllocation.lines.map((l) => ({ nature: l.nature, accountId: l.account.id, amount: l.amount })),
    });
  }, [existingAllocation]);

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const base = `/companies/${company.id}/equity`;

  const run = async (fn: () => Promise<unknown>, after: () => Promise<void> | void) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await after();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitMovement = () =>
    run(
      () => api.post(`${base}/movements`, {
        ...movement,
        amount: movement.amount,
      }),
      async () => {
        setMovement((m) => ({ ...m, amount: '', description: '', documentRef: '' }));
        await reload();
      },
    );

  const approve = () => {
    if (!decision) return;
    const path =
      decision.kind === 'movement'
        ? `${base}/movements/${decision.id}/approve`
        : decision.kind === 'closing'
          ? `${base}/closings/${decision.id}/approve`
          : `${base}/closings/${decision.id}/allocation/approve`;
    void run(
      () => api.post(path, { confirm: confirmed, note }),
      async () => {
        setDecision(null);
        setNote('');
        setConfirmed(false);
        await reload();
        await reloadAllocation();
      },
    );
  };

  const prepareClosing = () =>
    run(
      () => api.post<{ closing: Closing }>(`${base}/closings`, { ...closingForm }),
      async () => {
        const refreshed = await api.get<Overview>(`/companies/${company.id}/equity/overview${qs({ from, to })}`);
        setPreview(refreshed.closings[0] ?? null);
        await reload();
      },
    );

  const allocationExpected = allocatableClosing ? exact(allocatableClosing.resultAmount) : 0n;
  const allocationAbs = allocationExpected < 0n ? -allocationExpected : allocationExpected;
  const allocationSum = allocation.lines.reduce((sum, l) => sum + exact(l.amount), 0n);
  const allocationDiffers = allocationSum !== allocationAbs;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('eq.title')}</h1>
          <div className="page-sub">{t('eq.subtitle')}</div>
        </div>
        <Button onClick={() => void reload()}>{t('common.refresh')}</Button>
      </div>
      <DemoNotice />
      <div className="alert alert-warn">{t('eq.disclaimer')}</div>

      <Card>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <Field label={t('common.from')}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('common.from')} />
          </Field>
          <Field label={t('common.to')}>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('common.to')} />
          </Field>
          {data?.statement.closedThrough && (
            <span className="page-sub">{t('eq.closedThrough')}: {data.statement.closedThrough}</span>
          )}
        </div>
        <div className="tabs" role="tablist" aria-label={t('eq.title')}>
          {(['statement', 'register', 'closing', 'allocation'] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
            >
              {t(`eq.tab.${key}`)}
            </button>
          ))}
        </div>
        <ErrorBanner message={error ?? actionError} />
        {loading ? (
          <Spinner />
        ) : !data ? (
          <EmptyState title={t('common.none')} />
        ) : (
          <>
            {tab === 'statement' && <StatementView statement={data.statement} locale={locale} />}

            {tab === 'register' && (
              <div className="grid grid-2">
                <Card title={t('eq.newMovement')}>
                  <div className="form-row">
                    <Field label={t('common.date')}>
                      <input type="date" value={movement.movementDate} onChange={(e) => setMovement({ ...movement, movementDate: e.target.value })} />
                    </Field>
                    <Field label={t('eq.category')}>
                      <select value={movement.category} onChange={(e) => setMovement({ ...movement, category: e.target.value })}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{t(`eq.category.${c}`)}</option>)}
                      </select>
                    </Field>
                    <Field label={t('eq.direction')}>
                      <select value={movement.direction} onChange={(e) => setMovement({ ...movement, direction: e.target.value })}>
                        <option value="increase">{t('eq.increase')}</option>
                        <option value="decrease">{t('eq.decrease')}</option>
                      </select>
                    </Field>
                    <Field label={t('common.amount')}>
                      <input inputMode="decimal" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} placeholder="0.00" />
                    </Field>
                  </div>
                  <div className="form-row">
                    <Field label={t('eq.equityAccount')}>
                      <select value={movement.equityAccountId} onChange={(e) => setMovement({ ...movement, equityAccountId: e.target.value })}>
                        {equityAccounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    </Field>
                    <Field label={t('eq.counterpartAccount')}>
                      <select value={movement.counterpartAccountId} onChange={(e) => setMovement({ ...movement, counterpartAccountId: e.target.value })}>
                        {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    </Field>
                    <Field label={t('eq.journal')}>
                      <select value={movement.journalId} onChange={(e) => setMovement({ ...movement, journalId: e.target.value })}>
                        {activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label={t('common.description')}>
                    <input value={movement.description} onChange={(e) => setMovement({ ...movement, description: e.target.value })} />
                  </Field>
                  <Field label={t('eq.documentRef')} hint={t('eq.documentRefHint')}>
                    <input value={movement.documentRef} onChange={(e) => setMovement({ ...movement, documentRef: e.target.value })} placeholder="PV-2026-001" />
                  </Field>
                  <Button variant="primary" disabled={busy} onClick={() => void submitMovement()}>{t('eq.addDraft')}</Button>
                </Card>

                <Card title={t('eq.history')}>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('eq.movementNo')}</th>
                          <th>{t('common.date')}</th>
                          <th>{t('eq.category')}</th>
                          <th className="num">{t('common.amount')}</th>
                          <th>{t('common.account')}</th>
                          <th>{t('eq.documentRef')}</th>
                          <th>{t('common.status')}</th>
                          <th>{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.movements.map((m) => (
                          <tr key={m.id} className={m.status === 'DRAFT' ? 'muted-row' : ''}>
                            <td className="mono">{m.movementNo}</td>
                            <td>{m.movementDate}</td>
                            <td>{t(`eq.category.${m.category}`)} · {m.direction === 'increase' ? '↑' : '↓'}</td>
                            <td className="num">{money(m.amount, locale, company.functional_currency)}</td>
                            <td>{m.equityAccount.code} → {m.counterpartAccount.code}</td>
                            <td>{m.documentRef}</td>
                            <td><Badge kind={statusKind(m.status)}>{t(`eq.status.${m.status}`)}</Badge></td>
                            <td>
                              {m.status === 'DRAFT' && (
                                <Button
                                  variant="link"
                                  onClick={() => {
                                    setDecision({ kind: 'movement', id: m.id, title: `${t('eq.approveMovement')} ${m.movementNo}` });
                                    setNote('');
                                    setConfirmed(false);
                                  }}
                                >
                                  {t('eq.approve')}
                                </Button>
                              )}
                              {m.status === 'APPROVED' && (
                                <Button
                                  variant="link"
                                  disabled={busy}
                                  onClick={() => void run(() => api.post(`${base}/movements/${m.id}/post`), reload)}
                                >
                                  {t('eq.post')}
                                </Button>
                              )}
                              {m.status === 'POSTED' && <span className="page-sub">{m.entryNo}</span>}
                            </td>
                          </tr>
                        ))}
                        {data.movements.length === 0 && (
                          <tr><td colSpan={8} className="page-sub">{t('common.none')}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {tab === 'closing' && (
              <div className="grid grid-2">
                <Card title={t('eq.prepareClosing')}>
                  <Field label={t('common.period')}>
                    <select
                      value={closingForm.periodId}
                      onChange={(e) => {
                        const period = openPeriods.find((p) => p.id === e.target.value);
                        const start = period ? defaultNextStart(period.end_date) : '';
                        setClosingForm({
                          ...closingForm,
                          periodId: e.target.value,
                          nextStartDate: start,
                          nextEndDate: start ? defaultNextEnd(start) : '',
                        });
                      }}
                    >
                      {openPeriods.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.start_date} → {p.end_date})</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('eq.journal')}>
                    <select value={closingForm.journalId} onChange={(e) => setClosingForm({ ...closingForm, journalId: e.target.value })}>
                      {activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('eq.resultAccount')} hint={t('eq.resultAccountHint')}>
                    <select value={closingForm.resultAccountId} onChange={(e) => setClosingForm({ ...closingForm, resultAccountId: e.target.value })}>
                      {equityAccounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </Field>
                  <div className="form-row">
                    <Field label={t('eq.nextStart')}>
                      <input type="date" value={closingForm.nextStartDate} onChange={(e) => setClosingForm({ ...closingForm, nextStartDate: e.target.value })} />
                    </Field>
                    <Field label={t('eq.nextEnd')}>
                      <input type="date" value={closingForm.nextEndDate} onChange={(e) => setClosingForm({ ...closingForm, nextEndDate: e.target.value })} />
                    </Field>
                  </div>
                  <Button variant="primary" disabled={busy || !closingForm.periodId} onClick={() => void prepareClosing()}>
                    {t('eq.prepare')}
                  </Button>
                  <p className="page-sub">{t('eq.prepareHint')}</p>
                </Card>

                <Card title={t('eq.preview')}>
                  {!preview ? (
                    <p className="page-sub">{t('eq.noPreview')}</p>
                  ) : (
                    <ClosingPreview
                      closing={preview}
                      locale={locale}
                      onApprove={() => {
                        setDecision({ kind: 'closing', id: preview.id, title: t('eq.approveClosing') });
                        setNote('');
                        setConfirmed(false);
                      }}
                      onPost={() => void run(() => api.post(`${base}/closings/${preview.id}/post`), async () => { setPreview(null); await reload(); })}
                      busy={busy}
                    />
                  )}
                </Card>

                <Card title={t('eq.closingHistory')} className="grid-span-2">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('common.period')}</th>
                          <th>{t('eq.version')}</th>
                          <th>{t('eq.resultAccount')}</th>
                          <th className="num">{t('eq.result')}</th>
                          <th>{t('common.status')}</th>
                          <th>{t('eq.entry')}</th>
                          <th>{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.closings.map((c) => (
                          <tr key={c.id}>
                            <td>{c.sourceStart} → {c.sourceEnd}</td>
                            <td>v{c.version}</td>
                            <td>{c.resultAccount.code} — {c.resultAccount.name}</td>
                            <td className="num">{money(c.resultAmount, locale, company.functional_currency)}</td>
                            <td><Badge kind={statusKind(c.status)}>{t(`eq.status.${c.status}`)}</Badge></td>
                            <td className="mono">{c.closingEntryNo ?? '—'}</td>
                            <td>
                              <Button variant="link" onClick={() => setPreview(c)}>{t('eq.view')}</Button>
                            </td>
                          </tr>
                        ))}
                        {data.closings.length === 0 && (
                          <tr><td colSpan={7} className="page-sub">{t('common.none')}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {tab === 'allocation' && (
              <div className="grid grid-2">
                <Card title={t('eq.allocateResult')}>
                  {postedClosings.length === 0 ? (
                    <p className="page-sub">{t('eq.noPostedClosing')}</p>
                  ) : (
                    <>
                      <Field label={t('eq.postedClosing')}>
                        <select value={allocationClosingId} onChange={(e) => setAllocationClosingId(e.target.value)}>
                          <option value="">—</option>
                          {postedClosings.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.sourceStart} → {c.sourceEnd} · {money(c.resultAmount, locale, company.functional_currency)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {allocatableClosing && (
                        <>
                          <p className="page-sub">{t('eq.resultToAllocate')}: <strong>{money(allocatableClosing.resultAmount, locale, company.functional_currency)}</strong></p>
                          <div className="form-row">
                            <Field label={t('eq.decisionDate')}>
                              <input type="date" value={allocation.decisionDate} onChange={(e) => setAllocation({ ...allocation, decisionDate: e.target.value })} />
                            </Field>
                            <Field label={t('common.date')}>
                              <input type="date" value={allocation.allocationDate} onChange={(e) => setAllocation({ ...allocation, allocationDate: e.target.value })} />
                            </Field>
                            <Field label={t('eq.journal')}>
                              <select value={allocation.journalId} onChange={(e) => setAllocation({ ...allocation, journalId: e.target.value })}>
                                {activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
                              </select>
                            </Field>
                          </div>
                          <Field label={t('eq.documentRef')} hint={t('eq.documentRefHint')}>
                            <input value={allocation.documentRef} onChange={(e) => setAllocation({ ...allocation, documentRef: e.target.value })} />
                          </Field>
                          <Field label={t('eq.decisionNote')}>
                            <textarea rows={3} value={allocation.note} onChange={(e) => setAllocation({ ...allocation, note: e.target.value })} />
                          </Field>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>{t('eq.nature')}</th>
                                  <th>{t('common.account')}</th>
                                  <th className="num">{t('common.amount')}</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {allocation.lines.map((line, index) => (
                                  <tr key={index}>
                                    <td>
                                      <select value={line.nature} onChange={(e) => {
                                        const lines = [...allocation.lines];
                                        lines[index] = { ...line, nature: e.target.value };
                                        setAllocation({ ...allocation, lines });
                                      }}>
                                        {NATURES.map((n) => <option key={n} value={n}>{t(`eq.nature.${n}`)}</option>)}
                                      </select>
                                    </td>
                                    <td>
                                      <select value={line.accountId} onChange={(e) => {
                                        const lines = [...allocation.lines];
                                        lines[index] = { ...line, accountId: e.target.value };
                                        setAllocation({ ...allocation, lines });
                                      }}>
                                        {equityAccounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                                      </select>
                                    </td>
                                    <td>
                                      <input inputMode="decimal" value={line.amount} onChange={(e) => {
                                        const lines = [...allocation.lines];
                                        lines[index] = { ...line, amount: e.target.value };
                                        setAllocation({ ...allocation, lines });
                                      }} />
                                    </td>
                                    <td>
                                      <Button variant="link" onClick={() => setAllocation({ ...allocation, lines: allocation.lines.filter((_, i) => i !== index) })}>
                                        {t('common.remove')}
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="form-row">
                            <Button onClick={() => setAllocation({
                              ...allocation,
                              lines: [...allocation.lines, {
                                nature: 'retained_earnings',
                                accountId: equityAccounts.find((a) => a.is_active && a.id !== allocatableClosing.resultAccount.id)?.id ?? equityAccounts[0]?.id ?? '',
                                amount: '',
                              }],
                            })}>
                              {t('common.add')}
                            </Button>
                            <span className="page-sub">
                              {t('eq.allocatedTotal')}: {money(allocationSum.toString(), locale, company.functional_currency)}
                            </span>
                            <Badge kind={allocationDiffers ? 'danger' : 'success'}>
                              {allocationDiffers ? t('eq.allocationDiffers') : t('eq.allocationExact')}
                            </Badge>
                          </div>
                          {existingAllocation && (
                            <p className="page-sub">
                              {t('common.status')}: {t(`eq.status.${existingAllocation.status}`)}
                              {existingAllocation.entryNo ? ` · ${existingAllocation.entryNo}` : ''}
                            </p>
                          )}
                          <div className="form-row">
                            <Button
                              variant="primary"
                              disabled={busy || allocationDiffers || allocation.lines.length === 0 || existingAllocation?.status === 'POSTED'}
                              onClick={() => void run(
                                () => api.put(`${base}/closings/${allocatableClosing.id}/allocation`, { ...allocation }),
                                async () => {
                                  await reloadAllocation();
                                  await reload();
                                },
                              )}
                            >
                              {t('common.save')}
                            </Button>
                            {existingAllocation?.status === 'DRAFT' && (
                              <Button
                                onClick={() => {
                                  setDecision({ kind: 'allocation', id: allocatableClosing.id, title: t('eq.approveAllocation') });
                                  setNote('');
                                  setConfirmed(false);
                                }}
                              >
                                {t('eq.approve')}
                              </Button>
                            )}
                            {existingAllocation?.status === 'APPROVED' && (
                              <Button
                                disabled={busy}
                                onClick={() => void run(
                                  () => api.post(`${base}/closings/${allocatableClosing.id}/allocation/post`),
                                  async () => {
                                    await reloadAllocation();
                                    await reload();
                                  },
                                )}
                              >
                                {t('eq.post')}
                              </Button>
                            )}
                          </div>
                          <p className="page-sub">{t('eq.allocationHint')}</p>
                        </>
                      )}
                    </>
                  )}
                </Card>

                <Card title={t('eq.allocationHistory')}>
                  <p className="page-sub">{t(existingAllocation ? 'eq.allocationExists' : 'eq.noAllocation')}</p>
                  {existingAllocation && (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('eq.nature')}</th>
                            <th>{t('common.account')}</th>
                            <th className="num">{t('common.amount')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {existingAllocation.lines.map((l) => (
                            <tr key={l.id}>
                              <td>{t(`eq.nature.${l.nature}`)}</td>
                              <td>{l.account.code} — {l.account.name}</td>
                              <td className="num">{money(l.amount, locale, company.functional_currency)}</td>
                            </tr>
                          ))}
                          <tr className="total-row">
                            <td colSpan={2}>{t('eq.allocatedTotal')}</td>
                            <td className="num">{money(existingAllocation.allocatedAmount, locale, company.functional_currency)}</td>
                          </tr>
                          <tr>
                            <td colSpan={2}>{t('eq.unallocated')}</td>
                            <td className="num">{money(existingAllocation.unallocatedAmount, locale, company.functional_currency)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        open={!!decision}
        title={decision?.title ?? ''}
        onClose={() => {
          setDecision(null);
          setNote('');
          setConfirmed(false);
        }}
      >
        <ErrorBanner message={actionError} />
        <p className="page-sub">{t('eq.decisionHint')}</p>
        <Field label={t('eq.decisionNote')} hint={t('eq.decisionNoteHint')}>
          <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="field">
          <span className="field-label">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{' '}
            {t('eq.confirmDecision')}
          </span>
        </label>
        <div className="form-row">
          <Button
            variant="primary"
            disabled={busy || !confirmed || note.trim().length < 10}
            onClick={() => void approve()}
          >
            {t('eq.approve')}
          </Button>
          <Button onClick={() => { setDecision(null); setNote(''); setConfirmed(false); }}>{t('common.cancel')}</Button>
        </div>
      </Modal>
    </>
  );
}

function StatementView({ statement, locale }: { statement: Statement; locale: 'fr' | 'en' }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-2">
      <div>
        <h2 style={{ marginBottom: 8 }}>{t('eq.statementTitle')}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.account')}</th>
                <th className="num">{t('eq.opening')}</th>
                <th className="num">{t('eq.increases')}</th>
                <th className="num">{t('eq.decreases')}</th>
                <th className="num">{t('eq.closing')}</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((row) => (
                <tr key={row.accountId}>
                  <td><span className="mono">{row.code}</span> — {row.name}</td>
                  <td className="num">{money(row.opening, locale)}</td>
                  <td className="num">{money(row.increases, locale)}</td>
                  <td className="num">{money(row.decreases, locale)}</td>
                  <td className="num">{money(row.closing, locale)}</td>
                </tr>
              ))}
              {statement.rows.length === 0 && (
                <tr><td colSpan={5} className="page-sub">{t('common.none')}</td></tr>
              )}
              <tr className="total-row">
                <td>{t('common.total')}</td>
                <td className="num">{money(statement.totals.opening, locale)}</td>
                <td className="num">{money(statement.totals.increases, locale)}</td>
                <td className="num">{money(statement.totals.decreases, locale)}</td>
                <td className="num">{money(statement.totals.closing, locale)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="page-sub">{locale === 'fr' ? statement.noteFr : statement.note}</p>
      </div>
      <div>
        <h2 style={{ marginBottom: 8 }}>{t('eq.reconciliation')}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td>{t('eq.assets')}</td><td className="num">{money(statement.reconciliation.assets, locale)}</td></tr>
              <tr><td>{t('eq.liabilities')}</td><td className="num">{money(statement.reconciliation.liabilities, locale)}</td></tr>
              <tr><td>{t('eq.equityAccounts')}</td><td className="num">{money(statement.reconciliation.equityAccounts, locale)}</td></tr>
              <tr><td>{t('st.unappropriated')}</td><td className="num">{money(statement.unappropriatedResult, locale)}</td></tr>
              <tr className="total-row"><td>{t('eq.difference')}</td><td className="num">{money(statement.reconciliation.difference, locale)}</td></tr>
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8 }}>
          <Badge kind={statement.reconciliation.balanced ? 'success' : 'danger'}>
            {statement.reconciliation.balanced ? t('st.balanced') : t('st.unbalanced')}
          </Badge>{' '}
          <Badge kind={statement.reconciliation.trialBalanceBalanced ? 'success' : 'danger'}>
            {t('eq.trialBalanceAgrees')}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function ClosingPreview({
  closing, locale, onApprove, onPost, busy,
}: {
  closing: Closing;
  locale: 'fr' | 'en';
  onApprove: () => void;
  onPost: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const approuvable = closing.status === 'REVIEW_REQUIRED';
  return (
    <>
      <div className="form-row">
        <Badge kind={statusKind(closing.status)}>{t(`eq.status.${closing.status}`)}</Badge>
        <span className="page-sub">{t('eq.result')}: <strong>{money(closing.resultAmount, locale)}</strong></span>
      </div>
      <ul style={{ paddingLeft: 18, margin: '10px 0' }}>
        {closing.checks.map((check) => (
          <li key={check.code} className={check.severity === 'block' ? 'field-error' : check.severity === 'warning' ? 'field-hint' : 'page-sub'}>
            {locale === 'fr' ? check.messageFr : check.messageEn}
          </li>
        ))}
      </ul>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('common.account')}</th>
              <th>{t('common.description')}</th>
              <th className="num">{t('common.debit')}</th>
              <th className="num">{t('common.credit')}</th>
            </tr>
          </thead>
          <tbody>
            {closing.lines.map((line, index) => (
              <tr key={`${line.accountId}-${index}`}>
                <td><span className="mono">{line.code}</span> — {line.name}</td>
                <td>{line.description}</td>
                <td className="num">{money(line.debit, locale)}</td>
                <td className="num">{money(line.credit, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        {approuvable && <Button variant="primary" disabled={busy} onClick={onApprove}>{t('eq.approveClosing')}</Button>}
        {closing.status === 'APPROVED' && <Button disabled={busy} onClick={onPost}>{t('eq.postClosing')}</Button>}
        {closing.status === 'POSTED' && <span className="page-sub">{t('eq.closingLocked')}</span>}
      </div>
    </>
  );
}
