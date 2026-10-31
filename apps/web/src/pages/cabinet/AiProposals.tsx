import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';
import { money, scaled4ToString, toScaled4 } from '../../format';
import { demoEnabled } from '../../demo';

interface Account {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface Journal {
  id: string;
  code: string;
  name: string;
}

interface Check {
  key: string;
  label: string;
  ok: boolean;
  severity: 'error' | 'warning';
  message: string;
}

interface ProposalLine {
  id?: string;
  lineNo?: number;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  description: string | null;
  debit: string;
  credit: string;
}

interface Proposal {
  id: string;
  sourceKind: string;
  sourceId: string | null;
  status: 'proposed' | 'validated' | 'posted' | 'rejected';
  journalId: string | null;
  journalCode: string | null;
  entryDate: string;
  reference: string | null;
  description: string;
  currency: string;
  exchangeRate: string | null;
  confidence: number | null;
  rationale: string | null;
  warnings: string[];
  missing: string[];
  ruleTrace: string[];
  provider: string | null;
  model: string | null;
  entryId: string | null;
  lines: ProposalLine[];
  totals: { debit: string; credit: string; difference: string; balanced: boolean };
  checks: Check[];
  source: { kind: string; id: string; number: string | null; status: string } | null;
}

interface Invoice {
  id: string;
  kind: string;
  number: string | null;
  customerName: string;
  issueDate: string;
  total: string;
  currency: string;
  status: string;
  accountingEntryId: string | null;
}

interface EntryRule {
  id: string;
  ruleType: string;
  matchKey: string;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  counterAccountId: string | null;
  counterAccountCode: string | null;
  counterAccountName: string | null;
  journalCode: string | null;
  priority: number;
  version: number;
  isActive: boolean;
  accountSide: 'debit' | 'credit';
  notes: string | null;
  useCount: number;
}

const RULE_TYPES = [
  'counterparty',
  'bank_label',
  'expense_category',
  'billing_item',
  'payment_method',
  'journal',
] as const;

const statusKind = (status: Proposal['status']): 'warning' | 'info' | 'success' | 'danger' =>
  status === 'proposed' ? 'warning' : status === 'validated' ? 'info' : status === 'posted' ? 'success' : 'danger';

export default function AiProposalsPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rules, setRules] = useState<EntryRule[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('MUR');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));

  const [current, setCurrent] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<Proposal | null>(null);

  const [ruleForm, setRuleForm] = useState({
    ruleType: 'counterparty' as (typeof RULE_TYPES)[number],
    matchKey: '',
    accountId: '',
    counterAccountId: '',
    journalId: '',
    accountSide: 'debit' as 'debit' | 'credit',
    priority: '100',
  });

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const [accountRes, journalRes, proposalRes, ruleRes, invoiceRes] = await Promise.all([
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
        api.get<{ journals: Journal[] }>(`/companies/${company.id}/journals`),
        api.get<{ proposals: Proposal[] }>(`/companies/${company.id}/ai/entry-proposals`),
        api.get<{ rules: EntryRule[] }>(`/companies/${company.id}/ai/entry-rules?includeInactive=true`),
        api.get<{ documents: Invoice[] }>(`/companies/${company.id}/billing/documents?kind=invoice`),
      ]);
      setAccounts(accountRes.accounts.filter((a) => a.is_active));
      setJournals(journalRes.journals);
      setProposals(proposalRes.proposals);
      setRules(ruleRes.rules);
      setInvoices(
        invoiceRes.documents.filter(
          (d) => ['issued', 'partially_paid', 'paid'].includes(d.status) && !d.accountingEntryId,
        ),
      );
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const select = async (proposal: Proposal) => {
    setError(null);
    try {
      const res = await api.get<{ proposal: Proposal }>(
        `/companies/${company.id}/ai/entry-proposals/${proposal.id}`,
      );
      setCurrent(res.proposal);
      setDraft({
        ...res.proposal,
        lines: res.proposal.lines.map((l) => ({ ...l })),
      });
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const propose = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{
        proposal: Proposal;
        ruleApplied: { rule: { key: string; version: number } } | null;
        entryCreated: boolean;
      }>(`/companies/${company.id}/ai/entry-proposals`, {
        description,
        amount,
        currency,
        entryDate,
      });
      setNotice(
        res.ruleApplied
          ? `${t('ai.v2.ruleApplied')} : ${res.ruleApplied.rule.key} (v${res.ruleApplied.rule.version})`
          : t('ai.v2.proposed'),
      );
      await select(res.proposal);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const proposeFromInvoice = async (invoiceId: string) => {
    if (!invoiceId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ proposal: Proposal; reused: boolean; entryCreated: boolean }>(
        `/companies/${company.id}/ai/entry-proposals/from-billing`,
        { documentId: invoiceId },
      );
      setNotice(res.reused ? t('ai.v2.reused') : t('ai.v2.proposed'));
      await select(res.proposal);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<{ proposal: Proposal }>(
        `/companies/${company.id}/ai/entry-proposals/${draft.id}`,
        {
          journalId: draft.journalId ?? undefined,
          entryDate: draft.entryDate,
          reference: draft.reference,
          description: draft.description,
          currency: draft.currency,
          exchangeRate: draft.exchangeRate,
          lines: draft.lines.map((l) => ({
            accountId: l.accountId,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      );
      setCurrent(res.proposal);
      setDraft({ ...res.proposal, lines: res.proposal.lines.map((l) => ({ ...l })) });
      setNotice(t('ai.v2.saved'));
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const validate = async (acceptWarnings = false) => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ proposal: Proposal; entryCreated: boolean }>(
        `/companies/${company.id}/ai/entry-proposals/${current.id}/validate`,
        { acceptWarnings },
      );
      setCurrent(res.proposal);
      setNotice(t('ai.v2.validatedNotice'));
      await load();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'AI_PROPOSAL_INVALID' &&
        Array.isArray((err.details as { warnings?: string[] } | undefined)?.warnings)
      ) {
        if (window.confirm(t('ai.v2.acceptWarningsConfirm'))) {
          await validate(true);
        }
      } else {
        setError(errorMessage(err, t('common.error')).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!current) return;
    const note = window.prompt(t('ai.v2.rejectPrompt')) ?? '';
    setBusy(true);
    try {
      const res = await api.post<{ proposal: Proposal }>(
        `/companies/${company.id}/ai/entry-proposals/${current.id}/reject`,
        { note: note || null },
      );
      setCurrent(res.proposal);
      setNotice(t('ai.v2.rejectedNotice'));
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!current) return;
    if (!window.confirm(t('ai.v2.postConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ proposal: Proposal; entryId: string; entryNo: string; entryCreated: boolean }>(
        `/companies/${company.id}/ai/entry-proposals/${current.id}/post`,
      );
      setCurrent(res.proposal);
      setNotice(`${t('ai.v2.postedNotice')} ${res.entryNo}`);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRule = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${company.id}/ai/entry-rules`, {
        ruleType: ruleForm.ruleType,
        matchKey: ruleForm.matchKey,
        ...(ruleForm.accountId ? { accountId: ruleForm.accountId } : {}),
        ...(ruleForm.counterAccountId ? { counterAccountId: ruleForm.counterAccountId } : {}),
        ...(ruleForm.journalId ? { journalId: ruleForm.journalId } : {}),
        accountSide: ruleForm.accountSide,
        priority: Number(ruleForm.priority) || 100,
      });
      setNotice(t('ai.v2.ruleSaved'));
      setRuleForm({ ...ruleForm, matchKey: '' });
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const disableRule = async (rule: EntryRule) => {
    if (!window.confirm(t('ai.v2.disableConfirm'))) return;
    setBusy(true);
    try {
      await api.post(`/companies/${company.id}/ai/entry-rules/${rule.id}/disable`);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const updateDraftLine = (index: number, patch: Partial<ProposalLine>) => {
    if (!draft) return;
    const lines = draft.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    setDraft({ ...draft, lines });
  };

  const draftTotals = useMemo(() => {
    if (!draft) return { debit: 0n, credit: 0n, balanced: false };
    const sum = (key: 'debit' | 'credit') =>
      draft.lines.reduce((acc, l) => acc + (toScaled4(l[key]) ?? 0n), 0n);
    const debit = sum('debit');
    const credit = sum('credit');
    return { debit, credit, balanced: debit === credit && debit > 0n };
  }, [draft]);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('ai.v2.title')}</h1>
          <div className="page-sub">{t('ai.v2.sub')}</div>
        </div>
        <Button variant="ghost" onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      </div>

      {demoEnabled && <div className="banner banner-warning">{t('ai.demoNotice')}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}
      <ErrorBanner message={error} />

      <Card title={t('ai.v2.new')}>
        <div className="form-grid">
          <Field label={t('ai.v2.description')} hint={t('ai.v2.descriptionHint')}>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('ai.v2.descriptionPlaceholder')}
              maxLength={500}
            />
          </Field>
          <Field label={t('common.amount')}>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500.00" />
          </Field>
          <Field label={t('common.currency')}>
            <input
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('ai.v2.date')}>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
        </div>
        <div className="row-actions">
          <Button
            variant="primary"
            onClick={() => void propose()}
            disabled={busy || description.trim().length < 5 || !amount}
          >
            {t('ai.v2.propose')}
          </Button>
          {invoices.length > 0 && (
            <select
              value=""
              onChange={(e) => void proposeFromInvoice(e.target.value)}
              aria-label={t('ai.v2.fromBilling')}
            >
              <option value="">{t('ai.v2.fromBilling')}</option>
              {invoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.number} — {invoice.customerName} — {invoice.total} {invoice.currency}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="muted">{t('ai.v2.noAutoPosting')}</p>
      </Card>

      {current && draft && (
        <Card
          title={`${t('ai.v2.detail')} — ${current.source?.number ?? current.description}`}
          actions={
            <Badge kind={statusKind(current.status)}>{t(`ai.v2.status.${current.status}`)}</Badge>
          }
        >
          <div className="form-grid">
            <Field label={t('ai.v2.date')}>
              <input
                type="date"
                value={draft.entryDate}
                disabled={current.status === 'posted'}
                onChange={(e) => setDraft({ ...draft, entryDate: e.target.value })}
              />
            </Field>
            <Field label={t('ai.v2.journal')}>
              <select
                value={draft.journalId ?? ''}
                disabled={current.status === 'posted'}
                onChange={(e) => setDraft({ ...draft, journalId: e.target.value })}
              >
                <option value="">—</option>
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('ai.v2.reference')}>
              <input
                value={draft.reference ?? ''}
                disabled={current.status === 'posted'}
                onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
              />
            </Field>
            <Field label={t('ai.v2.description')}>
              <input
                value={draft.description}
                disabled={current.status === 'posted'}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
          </div>

          <div className="entry-lines">
            {draft.lines.map((line, index) => (
              <div className="entry-line" key={line.id ?? index}>
                <select
                  value={line.accountId}
                  disabled={current.status === 'posted'}
                  onChange={(e) => updateDraftLine(index, { accountId: e.target.value })}
                >
                  <option value="">{t('ai.v2.account')}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
                <input
                  value={line.description ?? ''}
                  disabled={current.status === 'posted'}
                  onChange={(e) => updateDraftLine(index, { description: e.target.value })}
                />
                <input
                  inputMode="decimal"
                  value={line.debit}
                  disabled={current.status === 'posted'}
                  placeholder={t('common.debit')}
                  onChange={(e) => updateDraftLine(index, { debit: e.target.value, credit: '0.0000' })}
                />
                <input
                  inputMode="decimal"
                  value={line.credit}
                  disabled={current.status === 'posted'}
                  placeholder={t('common.credit')}
                  onChange={(e) => updateDraftLine(index, { credit: e.target.value, debit: '0.0000' })}
                />
                {current.status !== 'posted' && draft.lines.length > 2 && (
                  <Button
                    variant="ghost"
                    onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}
                  >
                    ✕
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="row-actions">
            {current.status !== 'posted' && (
              <Button
                variant="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    lines: [
                      ...draft.lines,
                      {
                        accountId: accounts[0]?.id ?? '',
                        description: '',
                        debit: '0.0000',
                        credit: '0.0000',
                      },
                    ],
                  })
                }
              >
                {t('ai.v2.addLine')}
              </Button>
            )}
            <span className="entry-totals">
              <strong>{t('ai.v2.totals')}</strong> {scaled4ToString(draftTotals.debit)} / {scaled4ToString(draftTotals.credit)}{' '}
              <Badge kind={draftTotals.balanced ? 'success' : 'danger'}>
                {draftTotals.balanced ? t('ai.v2.balanced') : t('ai.v2.unbalanced')}
              </Badge>
            </span>
          </div>

          <p className="muted">
            {current.rationale}
            {current.provider && ` · ${current.provider}${current.model ? `/${current.model}` : ''}`}
          </p>
          {current.ruleTrace.length > 0 && (
            <ul className="plain-list">
              {current.ruleTrace.map((trace, i) => (
                <li key={i}>{trace}</li>
              ))}
            </ul>
          )}
          {current.warnings.map((w, i) => (
            <div className="alert alert-warn" key={`w-${i}`}>
              {w}
            </div>
          ))}
          {current.missing.length > 0 && (
            <div className="alert alert-warn">
              {t('ai.v2.missing')} : {current.missing.join(' · ')}
            </div>
          )}

          <h3>{t('ai.v2.checks')}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ai.v2.check')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('ai.v2.checkMessage')}</th>
                </tr>
              </thead>
              <tbody>
                {current.checks.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td>
                      <Badge kind={c.ok ? 'success' : c.severity === 'error' ? 'danger' : 'warning'}>
                        {c.ok ? t('ai.v2.checkOk') : c.severity === 'error' ? t('ai.v2.checkError') : t('ai.v2.checkWarning')}
                      </Badge>
                    </td>
                    <td className="page-sub">{c.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="modal-actions">
            {current.status === 'proposed' && (
              <>
                <Button variant="ghost" onClick={() => void saveDraft()} disabled={busy}>
                  {t('ai.v2.saveLines')}
                </Button>
                <Button variant="ghost" onClick={() => void reject()} disabled={busy}>
                  {t('ai.v2.reject')}
                </Button>
                <Button variant="primary" onClick={() => void validate()} disabled={busy}>
                  {t('ai.v2.validate')}
                </Button>
              </>
            )}
            {current.status === 'validated' && (
              <Button variant="primary" onClick={() => void post()} disabled={busy}>
                {t('ai.v2.post')}
              </Button>
            )}
            {current.status === 'posted' && current.entryId && (
              <Badge kind="success">{t('ai.v2.entryCreated')}</Badge>
            )}
            {current.source?.number && (
              <span className="page-sub">
                {t('ai.v2.source')} : {current.source.number} · {current.totals.debit} {current.currency}
              </span>
            )}
          </div>
        </Card>
      )}

      <Card title={t('ai.v2.proposals')}>
        {loading && proposals.length === 0 ? (
          <Spinner label={t('common.loading')} />
        ) : proposals.length === 0 ? (
          <EmptyState title={t('ai.v2.empty')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.description')}</th>
                  <th>{t('ai.v2.source')}</th>
                  <th className="num">{t('common.amount')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.description}
                      <div className="page-sub">
                        {p.entryDate} · {p.journalCode ?? '—'}
                      </div>
                    </td>
                    <td className="page-sub">{p.source?.number ?? p.sourceKind}</td>
                    <td className="num">{money(p.totals.debit, locale, p.currency)}</td>
                    <td>
                      <Badge kind={statusKind(p.status)}>{t(`ai.v2.status.${p.status}`)}</Badge>
                    </td>
                    <td className="row-actions">
                      <Button variant="ghost" onClick={() => void select(p)}>
                        {t('common.edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('ai.v2.rules')}>
        <p className="muted">{t('ai.v2.rulesHint')}</p>
        {rules.length === 0 ? (
          <EmptyState title={t('ai.v2.noRules')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ai.v2.ruleType')}</th>
                  <th>{t('ai.v2.ruleKey')}</th>
                  <th>{t('ai.v2.account')}</th>
                  <th>{t('ai.v2.counterAccount')}</th>
                  <th>v</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.ruleType}</td>
                    <td>{r.matchKey}</td>
                    <td className="mono">
                      {r.accountCode ? `${r.accountCode} — ${r.accountName}` : '—'}
                    </td>
                    <td className="mono">
                      {r.counterAccountCode ? `${r.counterAccountCode} — ${r.counterAccountName}` : '—'}
                    </td>
                    <td>{r.version}</td>
                    <td>
                      <Badge kind={r.isActive ? 'success' : 'neutral'}>
                        {r.isActive ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </td>
                    <td className="row-actions">
                      {r.isActive && (
                        <Button variant="ghost" onClick={() => void disableRule(r)} disabled={busy}>
                          {t('ai.v2.disable')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3>{t('ai.v2.ruleNew')}</h3>
        <div className="form-grid">
          <Field label={t('ai.v2.ruleType')}>
            <select
              value={ruleForm.ruleType}
              onChange={(e) => setRuleForm({ ...ruleForm, ruleType: e.target.value as (typeof RULE_TYPES)[number] })}
            >
              {RULE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('ai.v2.ruleKey')} hint={t('ai.v2.ruleKeyHint')}>
            <input
              value={ruleForm.matchKey}
              onChange={(e) => setRuleForm({ ...ruleForm, matchKey: e.target.value })}
              maxLength={120}
            />
          </Field>
          <Field label={t('ai.v2.account')}>
            <select
              value={ruleForm.accountId}
              onChange={(e) => setRuleForm({ ...ruleForm, accountId: e.target.value })}
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('ai.v2.counterAccount')}>
            <select
              value={ruleForm.counterAccountId}
              onChange={(e) => setRuleForm({ ...ruleForm, counterAccountId: e.target.value })}
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('ai.v2.journal')}>
            <select
              value={ruleForm.journalId}
              onChange={(e) => setRuleForm({ ...ruleForm, journalId: e.target.value })}
            >
              <option value="">—</option>
              {journals.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('ai.v2.priority')}>
            <input
              inputMode="numeric"
              value={ruleForm.priority}
              onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })}
            />
          </Field>
        </div>
        <Button
          variant="primary"
          onClick={() => void saveRule()}
          disabled={busy || ruleForm.matchKey.trim().length < 2 || (!ruleForm.accountId && !ruleForm.journalId)}
        >
          {t('ai.v2.ruleSave')}
        </Button>
        <p className="muted">{t('ai.v2.noTraining')}</p>
      </Card>
    </>
  );
}
