import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { demoEnabled } from '../../demo';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';

interface DocumentListRow {
  id: string; kind: 'purchase' | 'sale' | 'unknown'; status: string; original_name: string;
  mime_type: string; size_bytes: number; page_count: number; extraction_method: string;
  confidence: string | null; party_name: string | null; invoice_number: string | null;
  invoice_date: string | null; due_date: string | null; currency: string | null; subtotal: string | null;
  vat_total: string | null; total_amount: string | null; duplicate_of: string | null;
  created_at: string;
}
interface Extracted {
  supplierName?: string | null; customerName?: string | null; invoiceNumber?: string | null;
  invoiceDate?: string | null; dueDate?: string | null; currency?: string | null;
  subtotal?: string | null; vatTotal?: string | null; total?: string | null;
  references?: string[]; warnings?: string[];
  lines?: { description: string; quantity: string | null; unitPrice: string | null;
    netAmount: string; vatAmount: string; totalAmount: string }[];
}
interface ProposalLine {
  accountId: string | null; accountCode: string | null; accountName: string | null;
  description: string; debit: string; credit: string; needsAccount: boolean;
}
interface Proposal {
  id: string; status: 'PROPOSED' | 'APPROVED' | 'REJECTED'; kind: 'purchase' | 'sale';
  party_id: string | null; party_name: string | null; journal_id: string | null;
  entry_date: string; currency: string; lines: ProposalLine[]; balanced: boolean;
  uncertain_fields: string[]; draft_entry_id: string | null; created_at: string;
  rationale: { candidates?: { id: string; name: string; score: number }[]; debitTotal?: string; creditTotal?: string };
}
interface DocumentDetail {
  document: DocumentListRow & { extracted: Extracted; warnings: string[]; sha256: string };
  lines: { id: string; description: string; net_amount: string; vat_amount: string; total_amount: string }[];
  proposals: Proposal[];
}
interface Account { id: string; code: string; name: string; name_en: string | null; name_fr: string | null; type: string; is_active: boolean }
interface Journal { id: string; code: string; name: string; type: string }

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function fmt(value: string | null | undefined): string {
  if (!value) return '—';
  return Number(value).toLocaleString('en-MU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ScanImportPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const navigate = useNavigate();
  const [kind, setKind] = useState<'purchase' | 'sale'>('purchase');
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [corrections, setCorrections] = useState({ party_name: '', invoice_number: '', invoice_date: '', due_date: '', subtotal: '', vat_total: '', total_amount: '', currency: 'MUR' });
  const [draftLines, setDraftLines] = useState<{ accountId: string; description: string; debit: string; credit: string }[]>([]);
  const [journalId, setJournalId] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: list, loading: listLoading, reload: reloadList } = useAsync<{ documents: DocumentListRow[] } | null>(
    () => company ? api.get(`/companies/${company.id}/documents`) : Promise.resolve(null),
    [company?.id],
  );
  const { data: accountsData } = useAsync<{ accounts: Account[] } | null>(
    () => company ? api.get(`/companies/${company.id}/accounts`) : Promise.resolve(null),
    [company?.id],
  );
  const { data: journalsData } = useAsync<{ journals: Journal[] } | null>(
    () => company ? api.get(`/companies/${company.id}/journals`) : Promise.resolve(null),
    [company?.id],
  );
  const accounts = accountsData?.accounts ?? [];
  const journals = journalsData?.journals ?? [];
  const accountLabel = (a: Account) => `${a.code} — ${(locale === 'en' ? a.name_en : a.name_fr) || a.name}`;

  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  useEffect(() => {
    if (!company || !selected || demoEnabled) return;
    let url: string | null = null;
    let cancelled = false;
    fetch(`/api/companies/${company.id}/documents/${selected}/file`, { credentials: 'include' })
      .then((res) => res.ok ? res.blob() : Promise.reject(new Error(String(res.status))))
      .then((blob) => { if (!cancelled) { url = URL.createObjectURL(blob); setFileUrl(url); } })
      .catch(() => setFileUrl(null));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [company?.id, selected]);

  const loadDetail = async (id: string) => {
    if (!company) return;
    setSelected(id); setMessage(null); setError(null);
    try {
      const result = await api.get<DocumentDetail>(`/companies/${company.id}/documents/${id}`);
      setDetail(result);
      const d = result.document;
      setCorrections({
        party_name: d.party_name ?? '', invoice_number: d.invoice_number ?? '',
        invoice_date: d.invoice_date?.slice(0, 10) ?? '', due_date: d.due_date?.slice(0, 10) ?? '',
        subtotal: d.subtotal ?? '', vat_total: d.vat_total ?? '', total_amount: d.total_amount ?? '',
        currency: d.currency ?? 'MUR',
      });
      const proposal = result.proposals[0];
      if (proposal && proposal.status === 'PROPOSED') {
        setDraftLines(proposal.lines.map((l) => ({
          accountId: l.accountId ?? '', description: l.description,
          debit: l.debit === '0.0000' ? '' : String(Number(l.debit)),
          credit: l.credit === '0.0000' ? '' : String(Number(l.credit)),
        })));
        setJournalId(proposal.journal_id ?? '');
        setEntryDate(proposal.entry_date?.slice(0, 10) ?? '');
        setExchangeRate('');
      }
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
  };

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const choose = async (chosen: File | null) => {
    setError(null);
    if (!chosen) return;
    if (chosen.size > 8 * 1024 * 1024) { setError(t('docs.tooLarge')); return; }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(chosen.type)) {
      setError(t('docs.badType')); return;
    }
    setFile(chosen);
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(URL.createObjectURL(chosen));
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const contentBase64 = await readBase64(file);
      const result = await api.post<{ document: DocumentListRow }>(`/companies/${company.id}/documents`, {
        fileName: file.name, contentBase64, declaredMime: file.type, kind,
      });
      await reloadList();
      await loadDetail(result.document.id);
      setFile(null); setMessage(t('docs.uploaded'));
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setUploading(false); }
  };

  const saveCorrections = async () => {
    if (!detail) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/companies/${company.id}/documents/${detail.document.id}`, {
        party_name: corrections.party_name || null,
        invoice_number: corrections.invoice_number || null,
        invoice_date: corrections.invoice_date || null,
        due_date: corrections.due_date || null,
        currency: corrections.currency || null,
        subtotal: corrections.subtotal || null,
        vat_total: corrections.vat_total || null,
        total_amount: corrections.total_amount || null,
      });
      await loadDetail(detail.document.id);
      setMessage(t('docs.saved'));
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setBusy(false); }
  };

  const propose = async () => {
    if (!detail) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/companies/${company.id}/documents/${detail.document.id}/proposal`);
      await loadDetail(detail.document.id);
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setBusy(false); }
  };

  const approve = async (proposal: Proposal) => {
    if (!detail) return;
    setBusy(true); setError(null);
    try {
      const lines = draftLines.filter((l) => l.accountId).map((l) => ({
        accountId: l.accountId, description: l.description || null,
        debit: l.debit === '' ? null : l.debit, credit: l.credit === '' ? null : l.credit,
      }));
      const result = await api.post<{ draftEntry: { entry_no: string } }>(
        `/companies/${company.id}/documents/proposals/${proposal.id}/approve`,
        { confirm: true, lines, journalId: journalId || undefined, entryDate: entryDate || undefined,
          exchangeRate: exchangeRate || null },
      );
      setMessage(t('docs.draftCreated').replace('{no}', result.draftEntry.entry_no));
      await loadDetail(detail.document.id);
      await reloadList();
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setBusy(false); }
  };

  const reject = async (proposal: Proposal) => {
    if (rejectReason.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/companies/${company.id}/documents/proposals/${proposal.id}/reject`, { reason: rejectReason.trim() });
      setRejecting(false); setRejectReason('');
      if (detail) await loadDetail(detail.document.id);
      await reloadList();
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setBusy(false); }
  };

  const proposal = detail?.proposals.find((p) => p.status === 'PROPOSED') ?? detail?.proposals[0] ?? null;
  const previewUrl = demoEnabled ? localUrl : fileUrl;
  const totals = useMemo(() => {
    const debit = draftLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const credit = draftLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.00005 };
  }, [draftLines]);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('docs.title')}</h1>
          <div className="page-sub">{t('docs.subtitle')}</div>
        </div>
      </div>
      <DemoNotice />
      {demoEnabled && <Card><p className="page-sub" style={{ margin: 0 }}>{t('docs.demoPreRecorded')}</p></Card>}
      <ErrorBanner message={error} />
      {message && <Card><p style={{ margin: 0 }}>{message}</p></Card>}

      <div className="docs-layout">
        <Card>
          <h2>{t('docs.new')}</h2>
          <div className="form-row">
            <label className="inline">
              <input type="radio" checked={kind === 'purchase'} onChange={() => setKind('purchase')} />
              {t('docs.purchase')}
            </label>
            <label className="inline">
              <input type="radio" checked={kind === 'sale'} onChange={() => setKind('sale')} />
              {t('docs.sale')}
            </label>
          </div>
          <label className={`dropzone ${file ? 'has-file' : ''}`}>
            <input type="file" accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : t('docs.drop')}</span>
            <small>{t('docs.formats')}</small>
          </label>
          <Button variant="primary" disabled={!file || uploading} onClick={() => void upload()}>
            {uploading ? t('docs.extracting') : t('docs.upload')}
          </Button>
          <p className="page-sub">{t('docs.privacy')}</p>

          <h2 style={{ marginTop: 24 }}>{t('docs.history')}</h2>
          {listLoading ? <Spinner /> : !list?.documents.length ? (
            <p className="page-sub">{t('docs.noDocs')}</p>
          ) : (
            <ul className="doc-list">
              {list.documents.map((d) => (
                <li key={d.id}>
                  <button type="button" className={selected === d.id ? 'active' : ''}
                    onClick={() => void loadDetail(d.id)}>
                    <span className="doc-name">{d.invoice_number || d.original_name}</span>
                    <span className="page-sub">{d.party_name || '—'} · {d.invoice_date ?? '—'}</span>
                    <span className="doc-meta">
                      <Badge kind={d.status === 'APPROVED' ? 'success' : d.status === 'DUPLICATE' || d.status === 'REJECTED' ? 'danger' : 'info'}>
                        {t(`docs.status.${d.status}`)}
                      </Badge>
                      <span>{fmt(d.total_amount)} {d.currency ?? ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          {!detail ? (
            <Card><EmptyState title={t('docs.select')} /></Card>
          ) : (
            <>
              <Card>
                <div className="page-head" style={{ marginBottom: 8 }}>
                  <div className="grow">
                    <h2 style={{ margin: 0 }}>{detail.document.invoice_number || detail.document.original_name}</h2>
                    <div className="page-sub">
                      {t(`docs.method.${detail.document.extraction_method}`)} · {detail.document.page_count} {t('docs.pages')}
                    </div>
                  </div>
                  <Badge kind={detail.document.status === 'APPROVED' ? 'success' : 'info'}>
                    {t(`docs.status.${detail.document.status}`)}
                  </Badge>
                </div>
                {detail.document.status === 'DUPLICATE' && (
                  <p className="warning-text">{t('docs.duplicate')}</p>
                )}
                <div className="doc-view">
                  {previewUrl ? (
                    detail.document.mime_type === 'application/pdf' ? (
                      <iframe title={detail.document.original_name} src={previewUrl} />
                    ) : <img src={previewUrl} alt={detail.document.original_name} />
                  ) : <p className="page-sub">{demoEnabled ? t('docs.demoNoFile') : t('common.loading')}</p>}
                </div>
                <details>
                  <summary>{t('docs.warnings')} ({detail.document.warnings.length})</summary>
                  <ul>{detail.document.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </details>
              </Card>

              <Card>
                <h2>{t('docs.extracted')}</h2>
                <p className="page-sub">{t('docs.correctionNote')}</p>
                <div className="form-grid">
                  <Field label={t('docs.party')}>
                    <input value={corrections.party_name} onChange={(e) => setCorrections({ ...corrections, party_name: e.target.value })} />
                  </Field>
                  <Field label={t('docs.invoiceNo')}>
                    <input value={corrections.invoice_number} onChange={(e) => setCorrections({ ...corrections, invoice_number: e.target.value })} />
                  </Field>
                  <Field label={t('docs.date')}>
                    <input type="date" value={corrections.invoice_date} onChange={(e) => setCorrections({ ...corrections, invoice_date: e.target.value })} />
                  </Field>
                  <Field label={t('docs.due')}>
                    <input type="date" value={corrections.due_date} onChange={(e) => setCorrections({ ...corrections, due_date: e.target.value })} />
                  </Field>
                  <Field label={t('docs.subtotal')}>
                    <input inputMode="decimal" value={corrections.subtotal} onChange={(e) => setCorrections({ ...corrections, subtotal: e.target.value })} />
                  </Field>
                  <Field label={t('docs.vat')}>
                    <input inputMode="decimal" value={corrections.vat_total} onChange={(e) => setCorrections({ ...corrections, vat_total: e.target.value })} />
                  </Field>
                  <Field label={t('docs.total')}>
                    <input inputMode="decimal" value={corrections.total_amount} onChange={(e) => setCorrections({ ...corrections, total_amount: e.target.value })} />
                  </Field>
                  <Field label={t('docs.currency')}>
                    <select value={corrections.currency} onChange={(e) => setCorrections({ ...corrections, currency: e.target.value })}>
                      {['MUR', 'EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button onClick={() => void saveCorrections()} disabled={busy}>{t('docs.saveCorrections')}</Button>
                  <Button variant="primary" onClick={() => void propose()} disabled={busy || !detail.document.total_amount}>
                    {t('docs.generate')}
                  </Button>
                </div>
                {detail.lines.length > 0 && (
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table>
                      <thead><tr><th>{t('common.description')}</th><th>{t('docs.net')}</th><th>{t('docs.vat')}</th><th>{t('docs.total')}</th></tr></thead>
                      <tbody>
                        {detail.lines.map((l) => (
                          <tr key={l.id}>
                            <td>{l.description}</td><td>{fmt(l.net_amount)}</td><td>{fmt(l.vat_amount)}</td><td>{fmt(l.total_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {proposal && (
                <Card>
                  <div className="page-head" style={{ marginBottom: 8 }}>
                    <div className="grow">
                      <h2 style={{ margin: 0 }}>{t('docs.proposal')}</h2>
                      <div className="page-sub">{proposal.party_name ?? '—'} · {proposal.entry_date} · {proposal.currency}</div>
                    </div>
                    <Badge kind={proposal.status === 'APPROVED' ? 'success' : proposal.status === 'REJECTED' ? 'danger' : proposal.balanced ? 'info' : 'warning'}>
                      {proposal.status === 'PROPOSED' ? (proposal.balanced ? t('docs.balanced') : t('docs.unbalanced')) : t(`docs.status.${proposal.status}`)}
                    </Badge>
                  </div>
                  {proposal.rationale.candidates && proposal.rationale.candidates.length > 0 && (
                    <p className="page-sub">
                      {t('docs.partyCandidates')} : {proposal.rationale.candidates.map((c) => `${c.name} (${Math.round(c.score * 100)}%)`).join(', ')}
                    </p>
                  )}
                  {proposal.uncertain_fields.length > 0 && (
                    <p className="warning-text">{t('docs.uncertain')} : {proposal.uncertain_fields.join(', ')}</p>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>{t('common.account')}</th><th>{t('common.description')}</th><th>{t('common.debit')}</th><th>{t('common.credit')}</th></tr></thead>
                      <tbody>
                        {draftLines.map((line, i) => (
                          <tr key={i}>
                            <td>
                              <select value={line.accountId} disabled={proposal.status !== 'PROPOSED'}
                                onChange={(e) => setDraftLines(draftLines.map((l, j) => j === i ? { ...l, accountId: e.target.value } : l))}>
                                <option value="">{t('docs.chooseAccount')}</option>
                                {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                              </select>
                            </td>
                            <td>{line.description}</td>
                            <td><input inputMode="decimal" value={line.debit} disabled={proposal.status !== 'PROPOSED'}
                              onChange={(e) => setDraftLines(draftLines.map((l, j) => j === i ? { ...l, debit: e.target.value, credit: '' } : l))} /></td>
                            <td><input inputMode="decimal" value={line.credit} disabled={proposal.status !== 'PROPOSED'}
                              onChange={(e) => setDraftLines(draftLines.map((l, j) => j === i ? { ...l, credit: e.target.value, debit: '' } : l))} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}>{totals.balanced ? t('docs.entryBalanced') : t('docs.entryUnbalanced')}</td>
                          <td>{fmt(String(totals.debit))}</td><td>{fmt(String(totals.credit))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {proposal.status === 'PROPOSED' && (
                    <>
                      <div className="form-grid" style={{ marginTop: 12 }}>
                        <Field label={t('docs.journal')}>
                          <select value={journalId} onChange={(e) => setJournalId(e.target.value)}>
                            <option value="">—</option>
                            {journals.filter((j) => j.type === (proposal.kind === 'purchase' ? 'purchases' : 'sales'))
                              .map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
                          </select>
                        </Field>
                        <Field label={t('common.date')}>
                          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                        </Field>
                        {proposal.currency !== company.functional_currency && (
                          <Field label={t('docs.exchangeRate')}>
                            <input inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                          </Field>
                        )}
                      </div>
                      <p className="page-sub">{t('docs.approvalNote')}</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button variant="primary" disabled={busy || !totals.balanced || draftLines.some((l) => !l.accountId)}
                          onClick={() => void approve(proposal)}>
                          {t('docs.approve')}
                        </Button>
                        <Button variant="danger" onClick={() => setRejecting(true)}>{t('docs.reject')}</Button>
                      </div>
                      {rejecting && (
                        <div style={{ marginTop: 12 }}>
                          <Field label={t('docs.rejectReason')}>
                            <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                          </Field>
                          <Button variant="danger" disabled={rejectReason.trim().length < 3}
                            onClick={() => void reject(proposal)}>{t('docs.confirmReject')}</Button>
                        </div>
                      )}
                    </>
                  )}
                  {proposal.status === 'APPROVED' && proposal.draft_entry_id && (
                    <div style={{ marginTop: 12 }}>
                      <p>{t('docs.draftCreated').replace('{no}', '')}</p>
                      <Button onClick={() => navigate('/accounting/entries')}>{t('docs.openEntries')}</Button>
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
