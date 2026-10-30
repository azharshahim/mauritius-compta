import { useMemo, useState } from 'react';
import { api, qs } from '../api';
import { useI18n } from '../i18n';
import { errorMessage, useSession } from '../store';
import { useAsync } from '../hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Pagination,
  Spinner,
} from '../components/ui';
import { date, money, today } from '../format';

interface Journal {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface EntryListItem {
  id: string;
  entry_no: string;
  entry_date: string;
  reference: string | null;
  description: string;
  status: 'draft' | 'posted';
  currency: string;
  journal_code: string;
  journal_name: string;
  total_debit: string;
  reversal_entry_id: string | null;
}

interface LineDetail {
  id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  description: string | null;
  debit: string;
  credit: string;
  txn_amount: string | null;
  txn_currency: string;
  fx_rate: string | null;
}

interface EntryDetail {
  entry: EntryListItem & {
    exchange_rate: string;
    source: string;
    reversal_of_entry_id: string | null;
    reversed_entry_no: string | null;
    reversal_entry_no: string | null;
    posted_at: string | null;
  };
  lines: LineDetail[];
  attachments: { id: string; original_name: string; mime_type: string; size_bytes: number }[];
}

interface EditableLine {
  key: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

const newLine = (): EditableLine => ({
  key: Math.random().toString(36).slice(2),
  accountId: '',
  description: '',
  debit: '',
  credit: '',
});

export default function EntriesPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [status, setStatus] = useState('');
  const [journalId, setJournalId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const { data, loading, error, reload } = useAsync<{
    entries: EntryListItem[];
    total: number;
  } | null>(
    () =>
      company
        ? api.get(
            `/companies/${company.id}/entries${qs({ status, journalId, search, from, to, limit, offset })}`,
          )
        : Promise.resolve(null),
    [company?.id, status, journalId, search, from, to, offset],
  );

  const { data: meta } = useAsync<{ journals: Journal[]; accounts: Account[] } | null>(
    async () => {
      if (!company) return null;
      const [journals, accounts] = await Promise.all([
        api.get<{ journals: Journal[] }>(`/companies/${company.id}/journals`),
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
      ]);
      return { journals: journals.journals, accounts: accounts.accounts };
    },
    [company?.id],
  );

  const [editorOpen, setEditorOpen] = useState(false);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [journal, setJournal] = useState('');
  const [entryDate, setEntryDate] = useState(today());
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState(company?.functional_currency ?? 'MUR');
  const [rate, setRate] = useState('1');
  const [lines, setLines] = useState<EditableLine[]>([newLine(), newLine()]);

  const journals = meta?.journals ?? [];
  const accounts = meta?.accounts ?? [];
  const functional = company?.functional_currency ?? 'MUR';
  const isForeign = currency !== functional;

  const totals = useMemo(() => {
    const debit = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.00005 && debit > 0 };
  }, [lines]);

  const openEditor = () => {
    setJournal(journals[0]?.id ?? '');
    setEntryDate(today());
    setReference('');
    setDescription('');
    setCurrency(functional);
    setRate('1');
    setLines([newLine(), newLine()]);
    setFormError(null);
    setEditorOpen(true);
  };

  const openDetail = async (id: string) => {
    if (!company) return;
    try {
      const res = await api.get<EntryDetail>(`/companies/${company.id}/entries/${id}`);
      setDetail(res);
      setDetailOpen(true);
    } catch (err) {
      alert(errorMessage(err, t('common.error')).message);
    }
  };

  const save = async (mode: 'draft' | 'posted') => {
    if (!company) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.post(`/companies/${company.id}/entries`, {
        journalId: journal,
        entryDate,
        reference: reference || null,
        description,
        currency,
        exchangeRate: isForeign ? rate : undefined,
        status: mode,
        lines: lines
          .filter((l) => l.accountId && (l.debit || l.credit))
          .map((l) => ({
            accountId: l.accountId,
            description: l.description || null,
            debit: l.debit || undefined,
            credit: l.credit || undefined,
          })),
      });
      setEditorOpen(false);
      await reload();
    } catch (err) {
      setFormError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const postEntry = async (id: string) => {
    if (!company) return;
    try {
      await api.post(`/companies/${company.id}/entries/${id}/post`);
      setDetailOpen(false);
      await reload();
    } catch (err) {
      alert(errorMessage(err, t('common.error')).message);
    }
  };

  const reverseEntry = async (id: string) => {
    if (!company) return;
    const answer = prompt(t('entries.reversePrompt'), '');
    try {
      await api.post(`/companies/${company.id}/entries/${id}/reverse`, {
        entryDate: answer ? answer : undefined,
      });
      setDetailOpen(false);
      await reload();
    } catch (err) {
      alert(errorMessage(err, t('common.error')).message);
    }
  };

  const deleteEntry = async (id: string) => {
    if (!company || !confirm(t('common.confirmDelete'))) return;
    try {
      await api.del(`/companies/${company.id}/entries/${id}`);
      setDetailOpen(false);
      await reload();
    } catch (err) {
      alert(errorMessage(err, t('common.error')).message);
    }
  };

  const upload = async (file: File) => {
    if (!company || !detail) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await api.upload(`/companies/${company.id}/entries/${detail.entry.id}/attachments`, form);
      await openDetail(detail.entry.id);
    } catch (err) {
      alert(errorMessage(err, t('common.error')).message);
    }
  };

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('entries.title')}</h1>
          <div className="page-sub">
            {data?.total ?? 0} {t('entries.title').toLowerCase()} · {functional}
          </div>
        </div>
        <Button variant="primary" onClick={openEditor} disabled={journals.length === 0}>
          + {t('entries.new')}
        </Button>
      </div>

      <Card>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} style={{ maxWidth: 170 }}>
            <option value="">{t('entries.filterStatus')}</option>
            <option value="draft">{t('entries.draft')}</option>
            <option value="posted">{t('entries.posted')}</option>
          </select>
          <select value={journalId} onChange={(e) => { setJournalId(e.target.value); setOffset(0); }} style={{ maxWidth: 190 }}>
            <option value="">{t('common.all')} — {t('entries.journal')}</option>
            {journals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.name}
              </option>
            ))}
          </select>
          <input placeholder={t('common.search')} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} style={{ maxWidth: 220 }} />
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} style={{ maxWidth: 150 }} aria-label={t('common.from')} />
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} style={{ maxWidth: 150 }} aria-label={t('common.to')} />
        </div>
        <ErrorBanner message={error} />
        {loading ? (
          <Spinner />
        ) : (data?.entries.length ?? 0) === 0 ? (
          <EmptyState title={t('tb.empty')} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('entries.entryNo')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('entries.journal')}</th>
                    <th>{t('common.description')}</th>
                    <th>{t('common.reference')}</th>
                    <th className="num">{t('common.debit')}</th>
                    <th>{t('entries.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.entries.map((e) => (
                    <tr key={e.id} onClick={() => void openDetail(e.id)} style={{ cursor: 'pointer' }}>
                      <td className="mono">{e.entry_no}</td>
                      <td>{date(e.entry_date, locale)}</td>
                      <td>{e.journal_code}</td>
                      <td>
                        {e.description}
                        {e.reversal_entry_id && (
                          <>
                            {' '}
                            <Badge kind="info">{t('entries.reversedBy')}</Badge>
                          </>
                        )}
                      </td>
                      <td>{e.reference ?? '—'}</td>
                      <td className="num">{money(e.total_debit, locale, e.currency)}</td>
                      <td>
                        <Badge kind={e.status === 'posted' ? 'success' : 'warning'}>
                          {e.status === 'posted' ? t('entries.posted') : t('entries.draft')}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>

      {/* ------------------------------------------------------- editor */}
      <Modal open={editorOpen} title={t('entries.new')} onClose={() => setEditorOpen(false)} wide>
        <ErrorBanner message={formError} />
        <div className="form-grid">
          <Field label={t('entries.journal')}>
            <select value={journal} onChange={(e) => setJournal(e.target.value)} required>
              {journals.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('entries.date')}>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </Field>
          <Field label={t('common.reference')}>
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
          </Field>
          <Field label={t('common.currency')}>
            <select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setRate(e.target.value === functional ? '1' : '');
              }}
            >
              {[functional, 'EUR', 'USD', 'GBP'].filter((v, i, a) => a.indexOf(v) === i).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {isForeign && (
            <Field
              label={`${t('entries.exchangeRate')} (${currency} → ${functional})`}
              hint="Aucun taux n'est inventé : saisissez le taux daté."
            >
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="ex: 48.5000"
                required
              />
            </Field>
          )}
          <Field label={t('common.description')}>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              maxLength={300}
            />
          </Field>
        </div>

        <h3 style={{ margin: '8px 0' }}>{t('entries.lines')}</h3>
        <div className="entry-lines">
          {lines.map((line, index) => (
            <div className="entry-line" key={line.key}>
              <select
                value={line.accountId}
                onChange={(e) =>
                  setLines(lines.map((l, i) => (i === index ? { ...l, accountId: e.target.value } : l)))
                }
                aria-label={t('common.account')}
              >
                <option value="">— {t('common.account')} —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <input
                placeholder={t('common.description')}
                value={line.description}
                onChange={(e) =>
                  setLines(lines.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)))
                }
              />
              <input
                inputMode="decimal"
                placeholder={t('common.debit')}
                value={line.debit}
                onChange={(e) =>
                  setLines(
                    lines.map((l, i) =>
                      i === index ? { ...l, debit: e.target.value, credit: '' } : l,
                    ),
                  )
                }
                className="mono"
                aria-label={t('common.debit')}
              />
              <input
                inputMode="decimal"
                placeholder={t('common.credit')}
                value={line.credit}
                onChange={(e) =>
                  setLines(
                    lines.map((l, i) =>
                      i === index ? { ...l, credit: e.target.value, debit: '' } : l,
                    ),
                  )
                }
                className="mono"
                aria-label={t('common.credit')}
              />
              <button
                className="icon-btn"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
                aria-label={t('common.remove')}
                disabled={lines.length <= 2}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Button variant="ghost" onClick={() => setLines([...lines, newLine()])}>
            + {t('entries.addLine')}
          </Button>
        </div>

        <div className="entry-totals">
          <span>
            {t('entries.totalDebit')} : <strong>{money(totals.debit, locale, currency)}</strong>
          </span>
          <span>
            {t('common.credit')} : <strong>{money(totals.credit, locale, currency)}</strong>
          </span>
          <Badge kind={totals.balanced ? 'success' : 'danger'}>
            {totals.balanced ? t('entries.balanced') : t('entries.unbalanced')}
          </Badge>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button onClick={() => setEditorOpen(false)}>{t('common.cancel')}</Button>
          <Button disabled={busy} onClick={() => void save('draft')}>
            {t('entries.saveDraft')}
          </Button>
          <Button variant="primary" disabled={busy || !totals.balanced} onClick={() => void save('posted')}>
            {t('entries.savePosted')}
          </Button>
        </div>
      </Modal>

      {/* ------------------------------------------------------- detail */}
      <Modal open={detailOpen} title={detail?.entry.entry_no ?? ''} onClose={() => setDetailOpen(false)} wide>
        {detail && (
          <>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <Badge kind={detail.entry.status === 'posted' ? 'success' : 'warning'}>
                {detail.entry.status === 'posted' ? t('entries.posted') : t('entries.draft')}
              </Badge>
              <span className="page-sub">
                {detail.entry.journal_code} · {date(detail.entry.entry_date, locale)} ·{' '}
                {detail.entry.currency}
                {Number(detail.entry.exchange_rate) !== 1 && ` @ ${detail.entry.exchange_rate}`}
              </span>
              {detail.entry.reversal_of_entry_id && (
                <Badge kind="info">
                  {t('entries.reversalOf')} {detail.entry.reversed_entry_no}
                </Badge>
              )}
              {detail.entry.reversal_entry_no && (
                <Badge kind="info">
                  {t('entries.reversedBy')} {detail.entry.reversal_entry_no}
                </Badge>
              )}
            </div>
            <p>{detail.entry.description}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.account')}</th>
                    <th>{t('common.description')}</th>
                    <th className="num">{t('common.debit')}</th>
                    <th className="num">{t('common.credit')}</th>
                    {detail.lines.some((l) => l.txn_currency !== functional) && (
                      <th className="num">{t('common.amount')} ({t('common.currency')})</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="mono">{l.account_code}</span> — {l.account_name}
                      </td>
                      <td>{l.description ?? '—'}</td>
                      <td className="num">{money(l.debit, locale)}</td>
                      <td className="num">{money(l.credit, locale)}</td>
                      {detail.lines.some((x) => x.txn_currency !== functional) && (
                        <td className="num">
                          {l.txn_currency !== functional
                            ? `${money(l.txn_amount, locale, l.txn_currency)} @ ${l.fx_rate}`
                            : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ margin: '16px 0 8px' }}>{t('entries.attachment')}</h3>
            {detail.attachments.length === 0 ? (
              <p className="page-sub">{t('entries.noAttachments')}</p>
            ) : (
              <ul>
                {detail.attachments.map((a) => (
                  <li key={a.id}>
                    <a
                      href={`/api/companies/${company.id}/attachments/${a.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.original_name}
                    </a>{' '}
                    <span className="page-sub">({Math.round(a.size_bytes / 1024)} KB)</span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 8 }}>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
              {detail.entry.status === 'draft' && (
                <>
                  <Button variant="danger" onClick={() => void deleteEntry(detail.entry.id)}>
                    {t('common.delete')}
                  </Button>
                  <Button variant="primary" onClick={() => void postEntry(detail.entry.id)}>
                    {t('entries.post')}
                  </Button>
                </>
              )}
              {detail.entry.status === 'posted' && !detail.entry.reversal_entry_no && (
                <Button onClick={() => void reverseEntry(detail.entry.id)}>{t('entries.reverse')}</Button>
              )}
              <Button onClick={() => setDetailOpen(false)}>{t('common.close')}</Button>
            </div>
            {detail.entry.status === 'posted' && (
              <p className="page-sub" style={{ marginTop: 10 }}>
                {t('entries.postedLocked')}
              </p>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
