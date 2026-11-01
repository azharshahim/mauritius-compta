import { useCallback, useEffect, useState } from 'react';
import { api, downloadExport } from '../../api';
import { demoEnabled } from '../../demo/mode';
import { moneyExact } from '../../format';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Spinner } from '../../components/ui';

type Any = Record<string, any>;

const severityKind = (severity: string): 'success' | 'warning' | 'danger' | 'neutral' =>
  severity === 'block' ? 'danger' : severity === 'warning' ? 'warning' : 'success';

export default function DeclarationsPanel({
  company, periods, selectedPeriod, onSelectPeriod,
}: {
  company: { id: string; name: string };
  periods: Any[];
  selectedPeriod: Any | null;
  onSelectPeriod: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [employerIdentifier, setEmployerIdentifier] = useState(demoEnabled ? 'DEMO-ERN-0016' : '');
  const [preview, setPreview] = useState<Any | null>(null);
  const [history, setHistory] = useState<Any[]>([]);
  const [prepared, setPrepared] = useState<Any | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    setError(null);
    try {
      const query = employerIdentifier.trim()
        ? `?employerIdentifier=${encodeURIComponent(employerIdentifier.trim())}`
        : '';
      const [summary, list] = await Promise.all([
        api.get<Any>(`/companies/${company.id}/payroll/periods/${selectedPeriod.id}/mra-return${query}`),
        api.get<Any>(`/companies/${company.id}/payroll/declarations?periodId=${selectedPeriod.id}`),
      ]);
      setPreview(summary);
      setHistory(list.declarations ?? []);
      setPrepared((current: Any | null) =>
        current && (list.declarations ?? []).some((item: Any) => item.id === current.id) ? current : null);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company.id, employerIdentifier, selectedPeriod?.id, t]);

  useEffect(() => {
    setPrepared(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id, selectedPeriod?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 400);
    return () => window.clearTimeout(timer);
    // `load` already depends on the identifier; this avoids a request per keypress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employerIdentifier]);

  const prepare = async () => {
    if (!selectedPeriod) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<Any>(
        `/companies/${company.id}/payroll/periods/${selectedPeriod.id}/mra-return`,
        { employerIdentifier: employerIdentifier.trim() },
      );
      setPrepared(result.declaration);
      setNotice(t('payroll.declarations.prepared'));
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (declaration: Any) => {
    setError(null);
    try {
      await downloadExport(
        `/companies/${company.id}/payroll/declarations/${declaration.id}/csv`,
        `MRA-INTERNAL-PREPARATION-${declaration.period?.year ?? ''}${String(declaration.period?.month ?? '').padStart(2, '0')}-v${declaration.version ?? 1}.csv`,
        'csv',
      );
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  if (!selectedPeriod) {
    return <EmptyState title={t('payroll.declarations.noPeriod')} />;
  }

  const checks: Any[] = preview?.checks ?? [];
  const blockers = checks.filter((check) => check.severity === 'block');
  const warnings = checks.filter((check) => check.severity === 'warning');
  const amount = (value: unknown) => moneyExact(value as string, locale, preview?.currency ?? 'MUR');
  const message = (check: Any) => locale === 'fr' ? check.messageFr : check.messageEn;

  return (
    <>
      <Card title={t('payroll.declarations.title')}>
        <div className="alert alert-warning">
          <strong>{t('payroll.declarations.preparationOnly')}</strong> {t('payroll.declarations.notSubmitted')}
        </div>
        <ErrorBanner message={error} />
        {notice && <div className="alert alert-success">{notice}</div>}

        <div className="toolbar payroll-toolbar">
          <label className="field-inline"><span>{t('common.period')}</span>
            <select value={selectedPeriod.id} onChange={(event) => onSelectPeriod(event.target.value)}>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {String(period.period_month).padStart(2, '0')}/{period.period_year} — {period.status}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline"><span>{t('payroll.declarations.employerId')}</span>
            <input
              value={employerIdentifier}
              onChange={(event) => setEmployerIdentifier(event.target.value)}
              maxLength={40}
              placeholder={t('payroll.declarations.employerIdPlaceholder')}
              aria-label={t('payroll.declarations.employerId')}
            />
          </label>
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            {t('payroll.declarations.refresh')}
          </Button>
        </div>
        <p className="muted small">{t('payroll.declarations.employerIdHelp')}</p>

        {loading && !preview ? <Spinner label={t('common.loading')} /> : preview && (
          <>
            <div className="declaration-status">
              <Badge kind={preview.blockers?.length ? 'danger' : 'info'}>{preview.preparationStatus ?? preview.status}</Badge>
              <span>{preview.period?.label} · {preview.company?.name}</span>
              <span>{t('payroll.declarations.employeesCount')}: {preview.employees?.length ?? 0}</span>
              <Badge kind="warning">{t('payroll.declarations.notSubmittedBadge')}</Badge>
            </div>

            <div className="kpi-grid declaration-kpis">
              <div className="kpi"><div className="kpi-label">{t('payroll.declarations.totalRemunerations')}</div><div className="kpi-value">{amount(preview.totals?.gross)}</div></div>
              <div className="kpi"><div className="kpi-label">PAYE</div><div className="kpi-value">{amount(preview.totals?.paye)}</div></div>
              <div className="kpi"><div className="kpi-label">CSG / NSF</div><div className="kpi-value">{amount(preview.totals?.csgEmployee)} / {amount(preview.totals?.nsfEmployee)}</div></div>
              <div className="kpi"><div className="kpi-label">Training Levy</div><div className="kpi-value">{amount(preview.totals?.trainingLevy)}</div></div>
            </div>

            <div className="table-wrap">
              <table className="declaration-totals">
                <thead><tr><th>{t('payroll.declarations.companyTotals')}</th><th className="num">{t('common.amount')}</th></tr></thead>
                <tbody>
                  <tr><td>{t('payroll.declarations.totalBasicWage')}</td><td className="num">{amount(preview.totals?.basicWage)}</td></tr>
                  <tr><td>{t('payroll.declarations.totalTaxable')}</td><td className="num">{amount(preview.totals?.taxableEmoluments)}</td></tr>
                  <tr><th>{t('payroll.declarations.totalRemunerations')}</th><th className="num">{amount(preview.totals?.gross)}</th></tr>
                  <tr><td>{t('payroll.declarations.totalPaye')}</td><td className="num">{amount(preview.totals?.paye)}</td></tr>
                  <tr><td>{t('payroll.declarations.totalCsgEmployee')}</td><td className="num">{amount(preview.totals?.csgEmployee)}</td></tr>
                  <tr><td>{t('payroll.declarations.totalCsgEmployer')}</td><td className="num">{amount(preview.totals?.csgEmployer)}</td></tr>
                  <tr><td>{t('payroll.declarations.totalNsfEmployee')}</td><td className="num">{amount(preview.totals?.nsfEmployee)}</td></tr>
                  <tr><td>{t('payroll.declarations.totalNsfEmployer')}</td><td className="num">{amount(preview.totals?.nsfEmployer)}</td></tr>
                  <tr><td>{t('payroll.declarations.totalLevy')}</td><td className="num">{amount(preview.totals?.trainingLevy)}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="payroll-inline declaration-actions">
              <Button
                variant="primary"
                onClick={() => void prepare()}
                disabled={busy || loading || !preview.canPrepare}
              >
                {busy ? t('common.loading') : t('payroll.declarations.prepare')}
              </Button>
              {prepared && (
                <Button variant="ghost" onClick={() => void download(prepared)}>
                  {t('payroll.declarations.downloadInternal')}
                </Button>
              )}
              {!prepared && <span className="muted small">{t('payroll.declarations.prepareFirst')}</span>}
            </div>
            {(!preview.canPrepare) && (
              <p className="alert alert-error">{t('payroll.declarations.blockedHelp')}</p>
            )}
          </>
        )}
      </Card>

      {preview && (
        <Card title={t('payroll.declarations.checks')}>
          <div className="declaration-check-summary">
            <Badge kind={blockers.length ? 'danger' : 'success'}>{blockers.length} {t('payroll.declarations.blocking')}</Badge>
            <Badge kind={warnings.length ? 'warning' : 'success'}>{warnings.length} {t('payroll.declarations.warning')}</Badge>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('payroll.declarations.check')}</th><th>{t('common.status')}</th><th>{t('payroll.declarations.detail')}</th></tr></thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.code}>
                    <td><code>{check.code}</code></td>
                    <td><Badge kind={severityKind(check.severity)}>{check.severity}</Badge></td>
                    <td>{message(check)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {preview && (
        <Card title={t('payroll.declarations.perEmployee')}>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>{t('payroll.col.number')}</th><th>{t('common.name')}</th>
                <th className="num">{t('payroll.payslip.gross')}</th>
                <th className="num">PAYE</th>
                <th className="num">CSG</th>
                <th className="num">NSF</th>
                <th className="num">Levy</th>
                <th>{t('common.status')}</th>
              </tr></thead>
              <tbody>
                {(preview.employees ?? []).map((employee: Any) => (
                  <tr key={employee.employeeId}>
                    <td>{employee.employeeNumber}</td><td>{employee.fullName}</td>
                    <td className="num">{amount(employee.gross)}</td>
                    <td className="num">{amount(employee.paye)}</td>
                    <td className="num">{amount(employee.csgEmployee)} / {amount(employee.csgEmployer)}</td>
                    <td className="num">{amount(employee.nsfEmployee)} / {amount(employee.nsfEmployer)}</td>
                    <td className="num">{amount(employee.trainingLevy)}</td>
                    <td><Badge kind={employee.status === 'rules_incomplete' ? 'danger' : 'warning'}>{employee.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={t('payroll.declarations.officialExport')}>
        <div className="alert alert-warning">
          <strong>{t('payroll.declarations.officialUnavailable')}</strong> {t('payroll.declarations.officialWhy')}
        </div>
        <ul className="payroll-list">
          {(preview?.officialCsv?.reasons ?? []).map((reason: Any) => (
            <li key={reason.code}><code>{reason.code}</code> — {message(reason)}</li>
          ))}
        </ul>
        <p className="muted small">
          <a href="https://www.mra.mu/download/SpecsMonthlyPACODec2024.pdf" target="_blank" rel="noreferrer">MRA PACO specification (December 2024)</a>
          {' · '}
          <a href="https://www.mra.mu/index.php/eservices1/individual/monthly-paye-csg-nsf-return" target="_blank" rel="noreferrer">MRA Monthly PAYE / CSG / NSF Return</a>
        </p>
      </Card>

      <Card title={t('payroll.declarations.history')}>
        {history.length === 0 ? <EmptyState title={t('payroll.declarations.noHistory')} /> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>v</th><th>{t('payroll.declarations.preparedAt')}</th>
                <th>{t('payroll.declarations.employerId')}</th>
                <th className="num">{t('payroll.declarations.employeesCount')}</th>
                <th className="num">{t('payroll.payslip.gross')}</th>
                <th>{t('common.status')}</th><th />
              </tr></thead>
              <tbody>
                {history.map((declaration) => (
                  <tr key={declaration.id}>
                    <td>{declaration.version}</td>
                    <td>{String(declaration.preparedAt ?? '').slice(0, 19).replace('T', ' ')}</td>
                    <td>{declaration.employerIdentifier ?? '—'}</td>
                    <td className="num">{declaration.employees?.length ?? 0}</td>
                    <td className="num">{amount(declaration.totals?.gross)}</td>
                    <td><Badge kind="info">{declaration.status}</Badge></td>
                    <td><Button variant="ghost" onClick={() => void download(declaration)}>{t('payroll.declarations.downloadInternal')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
