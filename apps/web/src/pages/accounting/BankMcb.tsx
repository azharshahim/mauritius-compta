import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { demoEnabled } from '../../demo';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';

interface BankAccount { id: string; name: string; bank_name: string; currency: string; account_code: string; account_name: string; is_active: boolean }
interface Draft {
  rowNumber: number; txnDate: string | null; valueDate: string | null; label: string;
  amount: string; balance: string | null; action: 'import' | 'skip'; duplicate: boolean;
}
interface PreviewResponse {
  bankAccount: BankAccount;
  preview: {
    preview: {
      transactions: Draft[]; summary: { total: number; importable: number; duplicates: number; errors: number; warnings: number };
      blocksImport: boolean; totals: { in: string; out: string; net: string };
      balances: { opening: string | null; closing: string | null; computedClosing: string | null; consistent: boolean | null };
      findings: { severity: string; code: string; rowNumber: number | null; messageEn: string; messageFr: string }[];
    };
  };
  mcb: {
    openingBalance: string | null; closingBalance: string | null;
    warnings: { code: string; line: number | null; message: string }[];
    unparsedLines: { line: number; text: string }[];
    profile: string; compatibilityNote: string;
  };
  extraction: { method: string; pageCount: number; warnings: string[] };
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function fmt(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('en-MU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BankMcbPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ imported: number; duplicates: number; reimport: boolean } | null>(null);

  const { data: bankData, loading } = useAsync<{ accounts: BankAccount[] } | null>(
    () => company ? api.get(`/companies/${company.id}/bank/accounts`) : Promise.resolve(null),
    [company?.id],
  );
  const accounts = bankData?.accounts ?? [];

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const analyze = async () => {
    if (!file || !accountId) return;
    setBusy(true); setError(null); setPreview(null); setImported(null);
    try {
      const contentBase64 = await readBase64(file);
      const result = await api.post<PreviewResponse>(`/companies/${company.id}/bank/mcb/preview`, {
        bankAccountId: accountId, fileName: file.name, contentBase64,
      });
      setPreview(result);
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setBusy(false); }
  };

  const confirmImport = async () => {
    if (!file || !accountId || !preview) return;
    if (preview.preview.preview.blocksImport) return;
    setBusy(true); setError(null);
    try {
      const contentBase64 = await readBase64(file);
      const result = await api.post<{ imported: number; duplicates: number; reimport: boolean }>(
        `/companies/${company.id}/bank/mcb/import`,
        { bankAccountId: accountId, fileName: file.name, contentBase64, confirm: true },
      );
      setImported(result);
      setPreview(null);
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setBusy(false); }
  };

  const finding = (f: { messageEn: string; messageFr: string }) => locale === 'en' ? f.messageEn : f.messageFr;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('mcb.title')}</h1>
          <div className="page-sub">{t('mcb.subtitle')}</div>
        </div>
        <Button onClick={() => navigate('/accounting/banking')}>{t('mcb.backToBank')}</Button>
      </div>
      <DemoNotice />
      {demoEnabled && <Card><p className="page-sub" style={{ margin: 0 }}>{t('mcb.demoNote')}</p></Card>}
      <ErrorBanner message={error} />

      <Card>
        <h2>{t('mcb.chooseStatement')}</h2>
        {loading ? <Spinner /> : accounts.length === 0 ? (
          <EmptyState title={t('mcb.noBankAccount')} />
        ) : (
          <>
            <div className="form-grid">
              <Field label={t('mcb.bankAccount')}>
                <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
                  <option value="">—</option>
                  {accounts.filter((a) => a.is_active).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} · {a.account_code} {a.account_name} · {a.currency}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('mcb.pdf')}>
                <input type="file" accept="application/pdf,.pdf"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
              </Field>
            </div>
            {file && <p className="page-sub">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
            <Button variant="primary" disabled={!file || !accountId || busy} onClick={() => void analyze()}>
              {busy ? t('mcb.analyzing') : t('mcb.analyze')}
            </Button>
            <p className="page-sub">{t('mcb.scopeNote')}</p>
          </>
        )}
      </Card>

      {imported && (
        <Card>
          <h2>{t('mcb.imported')}</h2>
          <p>{imported.reimport ? t('mcb.alreadyImported') : t('mcb.importedCount').replace('{n}', String(imported.imported)).replace('{d}', String(imported.duplicates))}</p>
          <Button onClick={() => navigate(`/accounting/banking${accountId ? `?bankAccountId=${accountId}` : ''}`)}>{t('mcb.openBank')}</Button>
        </Card>
      )}

      {preview && (
        <>
          <Card>
            <div className="page-head" style={{ marginBottom: 8 }}>
              <div className="grow">
                <h2 style={{ margin: 0 }}>{t('mcb.extraction')}</h2>
                <div className="page-sub">{preview.mcb.profile} · {preview.extraction.method} · {preview.extraction.pageCount} {t('docs.pages')}</div>
              </div>
              <Badge kind={preview.preview.preview.balances.consistent === true ? 'success' : preview.preview.preview.balances.consistent === false ? 'danger' : 'warning'}>
                {preview.preview.preview.balances.consistent === true ? t('mcb.continuityOk')
                  : preview.preview.preview.balances.consistent === false ? t('mcb.continuityBroken') : t('mcb.continuityUnknown')}
              </Badge>
            </div>
            <div className="form-grid">
              <Field label={t('mcb.opening')}><div className="mono">{fmt(preview.mcb.openingBalance ?? preview.preview.preview.balances.opening)}</div></Field>
              <Field label={t('mcb.closing')}><div className="mono">{fmt(preview.mcb.closingBalance ?? preview.preview.preview.balances.closing)}</div></Field>
              <Field label={t('mcb.computedClosing')}><div className="mono">{fmt(preview.preview.preview.balances.computedClosing)}</div></Field>
              <Field label={t('mcb.transactions')}><div>{preview.preview.preview.summary.total}</div></Field>
            </div>
            {preview.mcb.warnings.length > 0 && (
              <details open>
                <summary>{t('mcb.extractionWarnings')} ({preview.mcb.warnings.length})</summary>
                <ul>{preview.mcb.warnings.map((w, i) => <li key={i}>{w.line ? `${w.line} · ` : ''}{w.code} — {w.message}</li>)}</ul>
              </details>
            )}
            {preview.mcb.unparsedLines.length > 0 && (
              <details>
                <summary>{t('mcb.unparsed')} ({preview.mcb.unparsedLines.length})</summary>
                <ul>{preview.mcb.unparsedLines.map((u) => <li key={u.line} className="mono">{u.line}: {u.text}</li>)}</ul>
              </details>
            )}
            {preview.preview.preview.findings.length > 0 && (
              <details open>
                <summary>{t('mcb.findings')} ({preview.preview.preview.findings.length})</summary>
                <ul>{preview.preview.preview.findings.slice(0, 30).map((f, i) => <li key={i}>{finding(f)}</li>)}</ul>
              </details>
            )}
            <p className="page-sub">{preview.mcb.compatibilityNote}</p>
          </Card>

          <Card>
            <h2>{t('mcb.preview')}</h2>
            <p className="page-sub">{t('mcb.previewNote')}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('common.date')}</th><th>{t('common.description')}</th><th>{t('common.debit')}</th><th>{t('common.credit')}</th><th>{t('common.balance')}</th><th>{t('common.status')}</th></tr></thead>
                <tbody>
                  {preview.preview.preview.transactions.map((d) => {
                    const amount = Number(d.amount);
                    return (
                      <tr key={`${d.rowNumber}-${d.label}`}>
                        <td className="mono">{d.txnDate ?? '—'}</td>
                        <td>{d.label}</td>
                        <td>{amount < 0 ? fmt(String(-amount)) : ''}</td>
                        <td>{amount > 0 ? fmt(d.amount) : ''}</td>
                        <td className="mono">{fmt(d.balance)}</td>
                        <td>{d.action === 'skip' ? <Badge kind="warning">{t('mcb.duplicateRow')}</Badge> : <Badge kind="success">{t('mcb.newRow')}</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="warning-text">{t('mcb.humanValidation')}</p>
            <Button variant="primary" disabled={busy || preview.preview.preview.blocksImport} onClick={() => void confirmImport()}>
              {busy ? t('common.loading') : t('mcb.confirmImport')}
            </Button>
          </Card>
        </>
      )}
    </>
  );
}
