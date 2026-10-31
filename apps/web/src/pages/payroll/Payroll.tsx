import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, downloadExport } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money } from '../../format';

type Any = Record<string, any>;

interface PayrollData {
  dashboard: Any | null;
  employees: Any[];
  contracts: Any[];
  payItems: Any[];
  time: Any[];
  absences: Any[];
  leaveRules: Any[];
  periods: Any[];
  variables: Any[];
  rules: Any[];
  calculations: Any[];
  payslips: Any[];
}

const EMPTY: PayrollData = {
  dashboard: null, employees: [], contracts: [], payItems: [], time: [], absences: [],
  leaveRules: [], periods: [], variables: [], rules: [], calculations: [], payslips: [],
};

const SECTIONS: Record<string, string> = {
  '': 'dashboard', contracts: 'contracts', employees: 'employees', time: 'time',
  leave: 'leave', variables: 'variables', periods: 'periods', calculations: 'calculations',
  payslips: 'payslips', rules: 'rules', declarations: 'declarations', transfer: 'transfer',
};

const badgeKind = (status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' => {
  if (['active', 'validated', 'approved', 'calculated', 'EXPERT_VALIDATED'].includes(status)) return 'success';
  if (['blocked', 'UNVERIFIED', 'CONFIGURATION_REQUIRED', 'MISSING', 'draft'].includes(status)) return 'warning';
  if (['rejected', 'cancelled', 'terminated', 'DEPRECATED'].includes(status)) return 'danger';
  if (['ready_for_review', 'data_collection', 'simulation', 'RESEARCHED'].includes(status)) return 'info';
  return 'neutral';
};

const read = (value: unknown, fallback = '—') =>
  (value === null || value === undefined || value === '' ? fallback : String(value));

export default function PayrollPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const location = useLocation();
  const sectionKey = location.pathname.replace(/^\/payroll\/?/, '').split('/')[0] ?? '';
  const section = SECTIONS[sectionKey] ?? 'dashboard';
  const [data, setData] = useState<PayrollData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<string | null>(null);
  const [detail, setDetail] = useState<Any | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    setError(null);
    const base = `/companies/${company.id}/payroll`;
    try {
      const dashboard = await api.get<Any>(`${base}/dashboard`);
      const [employees, contracts, payItems, time, leave, periods, rules, payslips] = await Promise.all([
        api.get<Any>(`${base}/employees`), api.get<Any>(`${base}/contracts`),
        api.get<Any>(`${base}/pay-items`), api.get<Any>(`${base}/time`),
        api.get<Any>(`${base}/leave`), api.get<Any>(`${base}/periods`),
        api.get<Any>(`${base}/rules`), api.get<Any>(`${base}/payslips`),
      ]);
      const selected = periodId || periods.periods?.[0]?.id || '';
      const [variables, calculations] = selected
        ? await Promise.all([
            api.get<Any>(`${base}/variables?periodId=${selected}`),
            api.get<Any>(`${base}/periods/${selected}/calculations`),
          ])
        : [{ variables: [] }, { calculations: [] }];
      if (!periodId && selected) setPeriodId(selected);
      setData({
        dashboard,
        employees: employees.employees ?? [],
        contracts: contracts.contracts ?? [],
        payItems: payItems.payItems ?? [],
        time: time.entries ?? [],
        absences: leave.absences ?? [],
        leaveRules: leave.rules ?? [],
        periods: periods.periods ?? [],
        rules: rules.rules ?? [],
        variables: variables.variables ?? [],
        calculations: calculations.calculations ?? [],
        payslips: payslips.payslips ?? [],
      });
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, periodId, t]);

  useEffect(() => { void load(); }, [load]);

  const selectedPeriod = useMemo(
    () => data.periods.find((p) => p.id === periodId) ?? data.periods[0],
    [data.periods, periodId],
  );
  const periodLabel = (p: Any) =>
    p ? `${String(p.period_month).padStart(2, '0')}/${p.period_year}` : '—';
  const employeeName = (id: string) => data.employees.find((e) => e.id === id)?.full_name ?? '—';
  const filteredEmployees = data.employees.filter((e) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return `${e.employee_number} ${e.full_name} ${e.email ?? ''} ${e.job_title ?? ''}`.toLowerCase().includes(q);
  });

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };
  const done = (msg: string) => { setModal(null); setNotice(msg); void load(); };

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;
  if (loading && !data.dashboard) return <Spinner label={t('common.loading')} />;

  const rulesBlocked = data.rules.filter(
    (r) => r.required_for_calculation && r.status !== 'EXPERT_VALIDATED',
  ).length;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('payroll.title')}</h1>
          <div className="page-sub">{t('payroll.sub')}</div>
        </div>
        <Badge kind="warning">{t('payroll.engineBlocked')}</Badge>
      </div>

      <div className="alert alert-warning payroll-disclaimer" role="status">
        <strong>{t('payroll.disclaimerTitle')}</strong> {t('payroll.disclaimer')}
      </div>
      <ErrorBanner message={error} />
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {section === 'dashboard' && (
        <>
          <div className="kpi-grid">
            <div className="kpi"><div className="kpi-label">{t('payroll.kpi.active')}</div><div className="kpi-value">{data.dashboard?.activeEmployees ?? 0}</div><div className="kpi-sub">{data.dashboard?.totalEmployees ?? 0} {t('payroll.kpi.total')}</div></div>
            <div className="kpi"><div className="kpi-label">{t('payroll.kpi.period')}</div><div className="kpi-value">{periodLabel(data.dashboard?.recentPeriods?.[0])}</div><div className="kpi-sub"><Badge kind={badgeKind(data.dashboard?.recentPeriods?.[0]?.status ?? 'draft')}>{data.dashboard?.recentPeriods?.[0]?.status ?? '—'}</Badge></div></div>
            <div className="kpi"><div className="kpi-label">{t('payroll.kpi.variables')}</div><div className="kpi-value">{data.dashboard?.variables?.draft ?? 0}</div><div className="kpi-sub">{t('payroll.kpi.variablesDraft')}</div></div>
            <div className="kpi"><div className="kpi-label">{t('payroll.kpi.rules')}</div><div className="kpi-value">{rulesBlocked}</div><div className="kpi-sub">{t('payroll.kpi.rulesBlocked')}</div></div>
          </div>
          <div className="payroll-columns">
            <Card title={t('payroll.dashboard.capabilities')}>
              <ul className="payroll-list">
                <li><Badge kind="success">✓</Badge> {t('payroll.cap.arithmetic')}</li>
                <li><Badge kind="warning">!</Badge> {t('payroll.cap.statutory')}</li>
                <li><Badge kind="warning">!</Badge> {t('payroll.cap.final')}</li>
                <li><Badge kind="warning">!</Badge> {t('payroll.cap.accounting')}</li>
              </ul>
              <p className="muted small">{data.dashboard?.notice}</p>
            </Card>
            <Card title={t('payroll.dashboard.checks')}>
              {data.dashboard?.missingContracts?.length ? (
                <>
                  <p className="small">{t('payroll.dashboard.missingContracts')}</p>
                  <ul>{data.dashboard.missingContracts.map((e: Any) => <li key={e.id}>{e.employee_number} — {e.full_name}</li>)}</ul>
                </>
              ) : <p className="muted small">{t('payroll.dashboard.noAnomaly')}</p>}
              <div className="payroll-inline">
                <Badge kind="info">{data.dashboard?.pendingLeave ?? 0} {t('payroll.dashboard.pendingLeave')}</Badge>
                <Badge kind="warning">{data.dashboard?.expiringContracts ?? 0} {t('payroll.dashboard.expiring')}</Badge>
              </div>
            </Card>
            <Card title={t('payroll.dashboard.periods')}>
              {data.periods.length === 0 ? <p className="muted">{t('payroll.noPeriods')}</p> : (
                <div className="payroll-inline">
                  {data.periods.slice(0, 4).map((p) => <Badge key={p.id} kind={badgeKind(p.status)}>{periodLabel(p)} · {p.status}</Badge>)}
                </div>
              )}
              <Button variant="ghost" onClick={() => setModal('period')}>{t('payroll.period.new')}</Button>
            </Card>
          </div>
        </>
      )}

      {section === 'employees' && (
        <Card title={t('payroll.employees.title')} actions={<Button variant="primary" onClick={() => setModal('employee')}>{t('payroll.employees.new')}</Button>}>
          <div className="toolbar">
            <input aria-label={t('common.search')} placeholder={t('payroll.employees.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="muted small">{filteredEmployees.length} / {data.employees.length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th>{t('payroll.col.job')}</th><th>{t('payroll.col.contract')}</th><th>{t('payroll.col.bank')}</th><th>{t('common.status')}</th><th /></tr></thead>
              <tbody>
                {filteredEmployees.map((e) => {
                  const activeContract = data.contracts.find((c) => c.employee_id === e.id && c.status === 'active');
                  return (
                    <tr key={e.id}>
                      <td>{e.employee_number}</td>
                      <td><strong>{e.full_name}</strong><div className="muted small">{e.email}</div></td>
                      <td>{read(e.job_title)}</td>
                      <td>{activeContract ? `${activeContract.salary_period} · ${activeContract.base_salary}` : <Badge kind="warning">{t('payroll.noContract')}</Badge>}</td>
                      <td>{e.bankAccountMasked ?? <span className="muted">—</span>}</td>
                      <td><Badge kind={badgeKind(e.employment_status)}>{e.employment_status}</Badge></td>
                      <td><Button variant="ghost" onClick={() => setDetail(e)}>{t('payroll.detail')}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === 'contracts' && (
        <Card title={t('payroll.contracts.title')} actions={<Button variant="primary" onClick={() => setModal('contract')}>{t('payroll.contracts.new')}</Button>}>
          <p className="muted small">{t('payroll.contracts.help')}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th>{t('common.type')}</th><th>{t('payroll.col.period')}</th><th>{t('common.from')}</th><th>{t('common.to')}</th><th className="num">{t('payroll.col.salary')}</th><th>{t('common.status')}</th><th>{t('payroll.col.reason')}</th></tr></thead>
              <tbody>
                {data.contracts.map((c) => {
                  const e = data.employees.find((x) => x.id === c.employee_id);
                  return <tr key={c.id}><td>{e?.employee_number}</td><td>{e?.full_name}</td><td>{c.contract_type} · {c.work_pattern}</td><td>{c.salary_period}</td><td>{c.effective_from}</td><td>{read(c.effective_to)}</td><td className="num">{c.base_salary} {c.currency}</td><td><Badge kind={badgeKind(c.status)}>{c.status}</Badge></td><td className="small">{c.change_reason}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === 'time' && (
        <Card title={t('payroll.time.title')} actions={<Button variant="primary" onClick={() => setModal('time')}>{t('payroll.time.new')}</Button>}>
          <p className="muted small">{t('payroll.time.help')}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('common.date')}</th><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th className="num">{t('payroll.time.hours')}</th><th className="num">{t('payroll.time.overtime')}</th><th className="num">{t('payroll.time.lateness')}</th><th>{t('payroll.col.source')}</th><th>{t('payroll.col.note')}</th></tr></thead>
              <tbody>
                {data.time.map((row) => <tr key={row.id}><td>{row.work_date}</td><td>{data.employees.find((e) => e.id === row.employee_id)?.employee_number}</td><td>{employeeName(row.employee_id)}</td><td className="num">{row.hours_worked}</td><td className="num">{row.overtime_hours}</td><td className="num">{row.lateness_minutes}</td><td>{row.source}</td><td className="small">{read(row.note)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === 'leave' && (
        <>
          <Card title={t('payroll.leave.title')} actions={<Button variant="primary" onClick={() => setModal('leave')}>{t('payroll.leave.new')}</Button>}>
            <p className="muted small">{t('payroll.leave.help')}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th>{t('payroll.leave.type')}</th><th>{t('common.from')}</th><th>{t('common.to')}</th><th className="num">{t('payroll.leave.days')}</th><th>{t('common.status')}</th><th>{t('payroll.col.reason')}</th><th /></tr></thead>
                <tbody>
                  {data.absences.map((a) => (
                    <tr key={a.id}>
                      <td>{data.employees.find((e) => e.id === a.employee_id)?.employee_number}</td>
                      <td>{employeeName(a.employee_id)}</td><td>{a.leave_type}</td><td>{a.start_date}</td><td>{a.end_date}</td>
                      <td className="num">{a.days}</td><td><Badge kind={badgeKind(a.status)}>{a.status}</Badge></td><td className="small">{a.reason}</td>
                      <td>
                        {a.status === 'requested' && (
                          <div className="payroll-inline">
                            <Button variant="ghost" onClick={() => void act(() => api.post(`/companies/${company.id}/payroll/leave/${a.id}/decision`, { decision: 'approved' }), t('payroll.leave.approved'))}>{t('payroll.approve')}</Button>
                            <Button variant="ghost" onClick={() => {
                              const reason = window.prompt(t('payroll.leave.rejectReason'));
                              if (reason) void act(() => api.post(`/companies/${company.id}/payroll/leave/${a.id}/decision`, { decision: 'rejected', reason }));
                            }}>{t('payroll.reject')}</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={t('payroll.leave.rules')}>
            <p className="alert alert-warning">{t('payroll.leave.noRule')}</p>
            {data.leaveRules.length > 0 && (
              <div className="table-wrap"><table><thead><tr><th>{t('payroll.leave.type')}</th><th>{t('payroll.leave.days')}</th><th>{t('common.from')}</th><th>{t('common.status')}</th></tr></thead><tbody>{data.leaveRules.map((r) => <tr key={r.id}><td>{r.leave_type}</td><td>{r.days_per_year}</td><td>{r.effective_from}</td><td><Badge kind={badgeKind(r.status)}>{r.status}</Badge></td></tr>)}</tbody></table></div>
            )}
            <Button variant="ghost" onClick={() => setModal('leave-rule')}>{t('payroll.leave.newRule')}</Button>
          </Card>
        </>
      )}

      {['variables', 'periods', 'calculations', 'payslips'].includes(section) && (
        <div className="toolbar payroll-toolbar">
          <label className="field-inline"><span>{t('common.period')}</span>
            <select value={selectedPeriod?.id ?? ''} onChange={(e) => setPeriodId(e.target.value)}>
              {data.periods.map((p) => <option key={p.id} value={p.id}>{periodLabel(p)} — {p.status}</option>)}
            </select>
          </label>
          <Badge kind={badgeKind(selectedPeriod?.status ?? 'draft')}>{selectedPeriod?.status ?? '—'}</Badge>
          {rulesBlocked > 0 && <Badge kind="warning">{rulesBlocked} {t('payroll.rulesMissing')}</Badge>}
        </div>
      )}

      {section === 'variables' && (
        <Card title={t('payroll.variables.title')} actions={<><Button variant="ghost" onClick={() => setModal('import')}>{t('payroll.variables.import')}</Button><Button variant="primary" onClick={() => setModal('variable')}>{t('payroll.variables.new')}</Button></>}>
          <p className="muted small">{t('payroll.variables.help')}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th>{t('payroll.col.item')}</th><th>{t('payroll.col.category')}</th><th className="num">{t('common.amount')}</th><th>{t('common.status')}</th><th>{t('payroll.col.source')}</th><th /></tr></thead>
              <tbody>
                {data.variables.map((v) => <tr key={v.id}><td>{v.employee_number}</td><td>{v.full_name}</td><td>{v.pay_item_code} — {locale === 'fr' ? v.label_fr : v.label_en}</td><td>{v.category}</td><td className="num">{money(v.amount, locale)}</td><td><Badge kind={badgeKind(v.status)}>{v.status}</Badge></td><td>{v.source}</td><td>{v.status === 'draft' && <Button variant="ghost" onClick={() => void act(() => api.post(`/companies/${company.id}/payroll/variables/${v.id}/validate`), t('payroll.variables.validated'))}>{t('payroll.validate')}</Button>}</td></tr>)}
              </tbody>
            </table>
          </div>
          {data.variables.length === 0 && <EmptyState title={t('payroll.variables.empty')} />}
        </Card>
      )}

      {section === 'periods' && (
        <Card title={t('payroll.periods.title')} actions={<Button variant="primary" onClick={() => setModal('period')}>{t('payroll.period.new')}</Button>}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('common.period')}</th><th>{t('common.from')}</th><th>{t('common.to')}</th><th>{t('payroll.period.payment')}</th><th>{t('common.status')}</th><th className="num">{t('payroll.period.calculations')}</th><th /></tr></thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.id}>
                    <td>{periodLabel(p)}</td><td>{p.start_date}</td><td>{p.end_date}</td><td>{read(p.payment_date)}</td>
                    <td><Badge kind={badgeKind(p.status)}>{p.status}</Badge></td><td className="num">{p.calculation_count ?? 0}</td>
                    <td>
                      <div className="payroll-inline">
                        {p.status === 'draft' && <Button variant="ghost" onClick={() => void act(() => api.patch(`/companies/${company.id}/payroll/periods/${p.id}/status`, { status: 'data_collection' }), t('payroll.period.collect'))}>{t('payroll.period.startCollect')}</Button>}
                        {['data_collection', 'ready_for_review', 'blocked'].includes(p.status) && <Button variant="primary" onClick={() => void act(() => api.post(`/companies/${company.id}/payroll/periods/${p.id}/calculate`, {}), t('payroll.period.calculated'))}>{t('payroll.period.calculate')}</Button>}
                        {p.status === 'blocked' && <Button variant="ghost" onClick={() => void act(() => api.patch(`/companies/${company.id}/payroll/periods/${p.id}/status`, { status: 'ready_for_review' }), t('payroll.period.review'))}>{t('payroll.period.review')}</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('payroll.period.help')}</p>
        </Card>
      )}

      {section === 'calculations' && (
        <Card title={t('payroll.calculations.title')}>
          <div className="alert alert-warning">{t('payroll.calculations.blocked')}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th className="num">{t('payroll.col.base')}</th><th className="num">{t('payroll.col.gross')}</th><th className="num">{t('payroll.col.deductions')}</th><th className="num">{t('payroll.col.netArithmetic')}</th><th className="num">PAYE / CSG / NSF</th><th>{t('common.status')}</th><th>{t('payroll.col.warnings')}</th></tr></thead>
              <tbody>
                {data.calculations.map((c) => (
                  <tr key={c.id}>
                    <td>{c.employee_number}</td><td>{c.full_name}</td>
                    <td className="num">{money(c.base_amount, locale, c.currency)}</td>
                    <td className="num">{money(c.gross, locale, c.currency)}</td>
                    <td className="num">{money(c.deductions, locale, c.currency)}</td>
                    <td className="num"><strong>{money(c.net_arithmetic, locale, c.currency)}</strong></td>
                    <td className="num"><Badge kind="warning">—</Badge></td>
                    <td><Badge kind={badgeKind(c.status)}>{c.status}</Badge></td>
                    <td className="small">{Array.isArray(c.warnings) && c.warnings.length > 0 ? c.warnings.map((w: Any) => <div key={w.code}>{w.code}</div>) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.calculations.length === 0 && <EmptyState title={t('payroll.calculations.empty')}><p>{t('payroll.calculations.emptyHelp')}</p></EmptyState>}
        </Card>
      )}

      {section === 'payslips' && (
        <Card title={t('payroll.payslips.title')} actions={<Button variant="ghost" onClick={() => downloadExport(`/companies/${company.id}/payroll/payslips.csv${selectedPeriod ? `?periodId=${selectedPeriod.id}` : ''}`, 'payroll-simulation.csv', 'csv')}>{t('common.exportCsv')}</Button>}>
          <div className="alert alert-warning">{t('payroll.payslips.officialBlocked')}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('payroll.payslips.number')}</th><th>{t('common.period')}</th><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th className="num">{t('payroll.col.gross')}</th><th className="num">{t('payroll.col.netArithmetic')}</th><th>{t('common.status')}</th><th /></tr></thead>
              <tbody>
                {data.payslips.map((p) => (
                  <tr key={p.id}>
                    <td>{p.payslip_no}</td><td>{periodLabel(p)}</td><td>{p.employee_number}</td><td>{p.full_name}</td>
                    <td className="num">{money(p.snapshot?.totals?.gross, locale, p.snapshot?.currency)}</td>
                    <td className="num">{money(p.snapshot?.totals?.netArithmetic, locale, p.snapshot?.currency)}</td>
                    <td><Badge kind="warning">{p.status}</Badge></td>
                    <td><Button variant="ghost" onClick={() => downloadExport(`/companies/${company.id}/payroll/payslips/${p.id}/pdf`, `${p.payslip_no}.pdf`, 'pdf')}>{t('common.exportPdf')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.calculations.length > 0 && (
            <>
              <h3 className="payroll-h3">{t('payroll.payslips.generate')}</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('payroll.col.number')}</th><th>{t('common.name')}</th><th>{t('common.status')}</th><th /></tr></thead>
                  <tbody>
                    {data.calculations.map((c) => (
                      <tr key={c.id}><td>{c.employee_number}</td><td>{c.full_name}</td><td><Badge kind={badgeKind(c.status)}>{c.status}</Badge></td>
                        <td>{data.payslips.some((p) => p.calculation_id === c.id) ? <Badge kind="info">{t('payroll.payslips.exists')}</Badge> : <Button variant="ghost" onClick={() => void act(() => api.post(`/companies/${company.id}/payroll/calculations/${c.id}/payslip`), t('payroll.payslips.generated'))}>{t('payroll.payslips.generateOne')}</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {data.payslips.length === 0 && <EmptyState title={t('payroll.payslips.empty')} />}
        </Card>
      )}

      {section === 'rules' && (
        <>
          <div className="payroll-columns">
            <Card title={t('payroll.rules.registry')}>
              <p className="muted small">{t('payroll.rules.help')}</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('common.code')}</th><th>{t('common.name')}</th><th>{t('payroll.rules.source')}</th><th>{t('payroll.col.effectiveFrom')}</th><th>{t('payroll.rules.rate')}</th><th>{t('common.status')}</th><th>{t('payroll.rules.version')}</th></tr></thead>
                  <tbody>
                    {data.rules.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.rule_code}</strong></td><td>{locale === 'fr' ? r.name_fr : r.name_en}</td>
                        <td className="small">{read(r.source_reference)}<div className="muted">{read(r.legal_source)}</div></td>
                        <td>{read(r.effective_from)}</td><td className="num">{r.rate === null ? '—' : r.rate}</td>
                        <td><Badge kind={badgeKind(r.status)}>{r.status}</Badge></td><td>{r.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title={t('payroll.rules.engine')}>
              <p className="alert alert-warning">{t('payroll.rules.engineBlocked')}</p>
              <p className="small">{t('payroll.rules.noInvention')}</p>
              <p className="small">{t('payroll.rules.validation')}</p>
              <Button variant="ghost" onClick={() => setModal('leave-rule')}>{t('payroll.leave.newRule')}</Button>
            </Card>
          </div>
          <Card title={t('payroll.payItems.title')}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('common.code')}</th><th>{t('common.description')}</th><th>{t('payroll.col.category')}</th><th>{t('payroll.col.unit')}</th><th>{t('payroll.col.method')}</th><th>{t('payroll.col.treatment')}</th><th>{t('payroll.col.effectiveFrom')}</th></tr></thead>
                <tbody>{data.payItems.map((i) => <tr key={i.id}><td>{i.code}</td><td>{locale === 'fr' ? i.label_fr : i.label_en}</td><td>{i.category}</td><td>{i.unit}</td><td>{i.calculation_method}</td><td><Badge kind={badgeKind(i.treatment_status)}>{i.treatment_status}</Badge></td><td>{i.effective_from}</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {(section === 'declarations' || section === 'transfer') && (
        <Card title={section === 'declarations' ? t('payroll.declarations.title') : t('payroll.transfer.title')}>
          <div className="alert alert-warning">{t('payroll.notImplemented')}</div>
          <ul className="payroll-list">
            <li>{t('payroll.transfer.never')}</li>
            <li>{t('payroll.declarations.never')}</li>
            <li>{t('payroll.transfer.accounts')}</li>
          </ul>
          {section === 'transfer' && selectedPeriod && (
            <Button variant="ghost" onClick={() => void act(async () => {
              const preview = await api.get<Any>(`/companies/${company.id}/payroll/periods/${selectedPeriod.id}/accounting-preview`);
              setNotice(`${t('payroll.transfer.preview')} : ${preview.postingBlocked ? t('payroll.transfer.blocked') : ''} — ${preview.note ?? ''}`);
            })}>{t('payroll.transfer.previewAction')}</Button>
          )}
        </Card>
      )}

      {modal === 'employee' && <EmployeeModal companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'contract' && <ContractModal employees={data.employees} companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'time' && <TimeModal employees={data.employees} companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'leave' && <LeaveModal employees={data.employees} companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'leave-rule' && <LeaveRuleModal companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'variable' && <VariableModal employees={data.employees} payItems={data.payItems} periods={data.periods} companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'import' && <ImportModal period={selectedPeriod} companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'period' && <PeriodModal companyId={company.id} onClose={() => setModal(null)} onDone={done} />}
      {detail && <EmployeeDetail employee={detail} contracts={data.contracts.filter((c) => c.employee_id === detail.id)} onClose={() => setDetail(null)} />}
    </>
  );
}

function EmployeeModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ employeeNumber: '', firstName: '', lastName: '', dateOfBirth: '', nationality: 'Mauritian', countryOfResidence: 'Mauritius', email: '', phone: '', hireDate: '', department: '', jobTitle: '', workLocation: 'Port Louis', costCentre: '', paymentMethod: 'bank_transfer', bankName: '', bankAccountNumber: '', statutoryId: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/companies/${companyId}/payroll/employees`, {
        ...form, email: form.email || undefined, dateOfBirth: form.dateOfBirth || undefined,
        hireDate: form.hireDate || undefined, bankAccountNumber: form.bankAccountNumber || undefined,
        statutoryId: form.statutoryId || undefined,
      });
      onDone(t('payroll.employees.created'));
    } catch (err) { setError(errorMessage(err, t('common.error')).message); } finally { setBusy(false); }
  };
  return (
    <Modal open title={t('payroll.employees.new')} onClose={onClose} wide>
      <ErrorBanner message={error} />
      <div className="form-grid">
        <Field label={`${t('payroll.col.number')} *`}><input value={form.employeeNumber} onChange={(e) => set('employeeNumber', e.target.value)} /></Field>
        <Field label={`${t('payroll.firstName')} *`}><input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
        <Field label={`${t('payroll.lastName')} *`}><input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
        <Field label={t('payroll.birth')}><input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
        <Field label={t('payroll.nationality')}><input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
        <Field label={t('payroll.country')}><input value={form.countryOfResidence} onChange={(e) => set('countryOfResidence', e.target.value)} /></Field>
        <Field label={t('payroll.email')}><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('payroll.phone')}><input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('payroll.hireDate')}><input type="date" value={form.hireDate} onChange={(e) => set('hireDate', e.target.value)} /></Field>
        <Field label={t('payroll.department')}><input value={form.department} onChange={(e) => set('department', e.target.value)} /></Field>
        <Field label={t('payroll.job')}><input value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
        <Field label={t('payroll.location')}><input value={form.workLocation} onChange={(e) => set('workLocation', e.target.value)} /></Field>
        <Field label={t('payroll.costCentre')}><input value={form.costCentre} onChange={(e) => set('costCentre', e.target.value)} /></Field>
        <Field label={t('payroll.payment')}><select value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}><option value="bank_transfer">bank_transfer</option><option value="cheque">cheque</option><option value="cash">cash</option></select></Field>
        <Field label={t('payroll.bankName')}><input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} /></Field>
        <Field label={t('payroll.bankNumber')} hint={t('payroll.bankHint')}><input value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} /></Field>
        <Field label={t('payroll.statutoryId')}><input value={form.statutoryId} onChange={(e) => set('statutoryId', e.target.value)} /></Field>
        <Field label={t('payroll.notes')}><input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => void submit()} disabled={busy || !form.employeeNumber || !form.firstName || !form.lastName}>{t('common.create')}</Button></div>
    </Modal>
  );
}

function ContractModal({ companyId, employees, onClose, onDone }: { companyId: string; employees: Any[]; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ employeeId: employees[0]?.id ?? '', contractType: 'permanent', workPattern: 'full_time', effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '', baseSalary: '', salaryPeriod: 'monthly', currency: 'MUR', weeklyHours: '40', changeReason: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/companies/${companyId}/payroll/contracts`, {
        ...form, effectiveTo: form.effectiveTo || undefined, weeklyHours: form.weeklyHours || undefined,
      });
      onDone(t('payroll.contracts.created'));
    } catch (err) { setError(errorMessage(err, t('common.error')).message); } finally { setBusy(false); }
  };
  return (
    <Modal open title={t('payroll.contracts.new')} onClose={onClose} wide>
      <ErrorBanner message={error} />
      <p className="alert alert-info">{t('payroll.contracts.history')}</p>
      <div className="form-grid">
        <Field label={`${t('payroll.employee')} *`}><select value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.employee_number} — {e.full_name}</option>)}</select></Field>
        <Field label={t('payroll.contract.type')}><select value={form.contractType} onChange={(e) => set('contractType', e.target.value)}><option value="permanent">permanent</option><option value="fixed_term">fixed_term</option></select></Field>
        <Field label={t('payroll.contract.pattern')}><select value={form.workPattern} onChange={(e) => set('workPattern', e.target.value)}><option value="full_time">full_time</option><option value="part_time">part_time</option></select></Field>
        <Field label={`${t('common.from')} *`}><input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} /></Field>
        <Field label={t('common.to')}><input type="date" value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} /></Field>
        <Field label={`${t('payroll.col.salary')} *`}><input inputMode="decimal" value={form.baseSalary} onChange={(e) => set('baseSalary', e.target.value)} /></Field>
        <Field label={t('payroll.contract.salaryPeriod')}><select value={form.salaryPeriod} onChange={(e) => set('salaryPeriod', e.target.value)}><option value="monthly">monthly</option><option value="hourly">hourly</option><option value="daily">daily</option></select></Field>
        <Field label={t('common.currency')}><input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
        <Field label={t('payroll.weeklyHours')}><input inputMode="decimal" value={form.weeklyHours} onChange={(e) => set('weeklyHours', e.target.value)} /></Field>
      </div>
      <Field label={`${t('payroll.contract.reason')} *`}><textarea rows={2} value={form.changeReason} onChange={(e) => set('changeReason', e.target.value)} /></Field>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => void submit()} disabled={busy || !form.employeeId || !form.baseSalary || !form.changeReason}>{t('common.create')}</Button></div>
    </Modal>
  );
}

function TimeModal({ companyId, employees, onClose, onDone }: { companyId: string; employees: Any[]; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ employeeId: employees[0]?.id ?? '', workDate: new Date().toISOString().slice(0, 10), hoursWorked: '8', overtimeHours: '0', latenessMinutes: '0', note: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Modal open title={t('payroll.time.new')} onClose={onClose}>
      <ErrorBanner message={error} />
      <p className="alert alert-info">{t('payroll.time.noPremium')}</p>
      <Field label={t('payroll.employee')}><select value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.employee_number} — {e.full_name}</option>)}</select></Field>
      <div className="form-grid">
        <Field label={t('common.date')}><input type="date" value={form.workDate} onChange={(e) => set('workDate', e.target.value)} /></Field>
        <Field label={t('payroll.time.hours')}><input inputMode="decimal" value={form.hoursWorked} onChange={(e) => set('hoursWorked', e.target.value)} /></Field>
        <Field label={t('payroll.time.overtime')}><input inputMode="decimal" value={form.overtimeHours} onChange={(e) => set('overtimeHours', e.target.value)} /></Field>
        <Field label={t('payroll.time.lateness')}><input inputMode="numeric" value={form.latenessMinutes} onChange={(e) => set('latenessMinutes', e.target.value)} /></Field>
      </div>
      <Field label={t('payroll.notes')}><input value={form.note} onChange={(e) => set('note', e.target.value)} /></Field>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => {
        void (async () => {
          try {
            await api.post(`/companies/${companyId}/payroll/time`, { ...form, latenessMinutes: Number(form.latenessMinutes) || 0 });
            onDone(t('payroll.time.created'));
          } catch (err) { setError(errorMessage(err, t('common.error')).message); }
        })();
      }}>{t('common.create')}</Button></div>
    </Modal>
  );
}

function LeaveModal({ companyId, employees, onClose, onDone }: { companyId: string; employees: Any[]; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ employeeId: employees[0]?.id ?? '', leaveType: 'annual', startDate: '', endDate: '', days: '1', reason: '', documentRef: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Modal open title={t('payroll.leave.new')} onClose={onClose}>
      <ErrorBanner message={error} />
      <p className="alert alert-warning">{t('payroll.leave.noRule')}</p>
      <Field label={t('payroll.employee')}><select value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.employee_number} — {e.full_name}</option>)}</select></Field>
      <div className="form-grid">
        <Field label={t('payroll.leave.type')}><select value={form.leaveType} onChange={(e) => set('leaveType', e.target.value)}>{['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other'].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
        <Field label={`${t('common.from')} *`}><input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label={`${t('common.to')} *`}><input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
        <Field label={t('payroll.leave.days')}><input inputMode="decimal" value={form.days} onChange={(e) => set('days', e.target.value)} /></Field>
      </div>
      <Field label={`${t('payroll.col.reason')} *`}><input value={form.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
      <Field label={t('payroll.leave.document')}><input value={form.documentRef} onChange={(e) => set('documentRef', e.target.value)} /></Field>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => {
        void (async () => {
          try {
            await api.post(`/companies/${companyId}/payroll/leave`, { ...form, documentRef: form.documentRef || undefined });
            onDone(t('payroll.leave.created'));
          } catch (err) { setError(errorMessage(err, t('common.error')).message); }
        })();
      }} disabled={!form.startDate || !form.endDate || !form.reason}>{t('common.create')}</Button></div>
    </Modal>
  );
}

function LeaveRuleModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ leaveType: 'annual', daysPerYear: '', effectiveFrom: new Date().toISOString().slice(0, 10), source: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Modal open title={t('payroll.leave.newRule')} onClose={onClose}>
      <ErrorBanner message={error} />
      <p className="alert alert-warning">{t('payroll.rules.noInvention')}</p>
      <Field label={t('payroll.leave.type')}><select value={form.leaveType} onChange={(e) => set('leaveType', e.target.value)}>{['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other'].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
      <div className="form-grid">
        <Field label={t('payroll.leave.daysPerYear')}><input inputMode="decimal" value={form.daysPerYear} onChange={(e) => set('daysPerYear', e.target.value)} /></Field>
        <Field label={t('payroll.col.effectiveFrom')}><input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} /></Field>
      </div>
      <Field label={t('payroll.rules.source')}><input value={form.source} onChange={(e) => set('source', e.target.value)} /></Field>
      <p className="small muted">{t('payroll.leave.ruleUnverified')}</p>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => {
        void (async () => {
          try {
            await api.post(`/companies/${companyId}/payroll/leave-rules`, form);
            onDone(t('payroll.leave.ruleCreated'));
          } catch (err) { setError(errorMessage(err, t('common.error')).message); }
        })();
      }} disabled={!form.daysPerYear}>{t('common.create')}</Button></div>
    </Modal>
  );
}

function VariableModal({ companyId, employees, payItems, periods, onClose, onDone }: { companyId: string; employees: Any[]; payItems: Any[]; periods: Any[]; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ periodId: periods[0]?.id ?? '', employeeId: employees[0]?.id ?? '', payItemId: payItems[0]?.id ?? '', amount: '', note: '', status: 'draft' });
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Modal open title={t('payroll.variables.new')} onClose={onClose}>
      <ErrorBanner message={error} />
      <p className="alert alert-info">{t('payroll.variables.validation')}</p>
      <div className="form-grid">
        <Field label={t('common.period')}><select value={form.periodId} onChange={(e) => set('periodId', e.target.value)}>{periods.map((p) => <option key={p.id} value={p.id}>{p.period_month}/{p.period_year} — {p.status}</option>)}</select></Field>
        <Field label={t('payroll.employee')}><select value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.employee_number} — {e.full_name}</option>)}</select></Field>
        <Field label={t('payroll.col.item')}><select value={form.payItemId} onChange={(e) => set('payItemId', e.target.value)}>{payItems.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.category}</option>)}</select></Field>
        <Field label={t('common.amount')}><input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label={t('common.status')}><select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="draft">draft</option><option value="validated">validated</option></select></Field>
      </div>
      <Field label={t('payroll.notes')}><input value={form.note} onChange={(e) => set('note', e.target.value)} /></Field>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => {
        void (async () => {
          try {
            await api.post(`/companies/${companyId}/payroll/variables`, { periodId: form.periodId, employeeId: form.employeeId, payItemId: form.payItemId, amount: form.amount, note: form.note || undefined, status: form.status });
            onDone(t('payroll.variables.created'));
          } catch (err) { setError(errorMessage(err, t('common.error')).message); }
        })();
      }} disabled={!form.amount}>{t('common.create')}</Button></div>
    </Modal>
  );
}

function ImportModal({ companyId, period, onClose, onDone }: { companyId: string; period: Any | undefined; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('employeeNumber;payItemCode;amount;externalRef\nA001;PRIME_DEMO;750;FICT-001');
  const [file, setFile] = useState<{ name: string; contentText?: string; contentBase64?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open title={t('payroll.variables.import')} onClose={onClose} wide>
      <ErrorBanner message={error} />
      <p className="muted small">{t('payroll.variables.importHelp')}</p>
      {!period ? <p className="alert alert-warning">{t('payroll.noPeriods')}</p> : (
        <>
          <Field label={t('common.period')}><input readOnly value={`${period.period_month}/${period.period_year}`} /></Field>
          <Field label={t('payroll.variables.importFile')} hint={t('payroll.variables.importFileHint')}>
            <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (!chosen) return;
              if (chosen.name.toLowerCase().endsWith('.xlsx')) {
                const reader = new FileReader();
                reader.onload = () => setFile({ name: chosen.name, contentBase64: String(reader.result).split(',')[1] ?? '' });
                reader.readAsDataURL(chosen);
              } else {
                void chosen.text().then((contentText) => setFile({ name: chosen.name, contentText }));
              }
            }} />
          </Field>
          {file && <p className="small"><Badge kind="info">{file.name}</Badge> <Button variant="ghost" onClick={() => setFile(null)}>{t('common.remove')}</Button></p>}
          <Field label={t('payroll.variables.importText')}><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></Field>
          <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => {
            void (async () => {
              try {
                let result: Any;
                if (file) {
                  result = await api.post<Any>(`/companies/${companyId}/payroll/periods/${period.id}/variables/import-file`, {
                    fileName: file.name,
                    ...(file.contentText ? { contentText: file.contentText } : { contentBase64: file.contentBase64 }),
                  });
                } else {
                  const [header, ...lines] = text.trim().split(/\r?\n/);
                  const columns = (header ?? '').split(';');
                  const rows = lines.filter(Boolean).map((line) => {
                    const values = line.split(';');
                    const row: Any = {};
                    columns.forEach((col, i) => { row[col.trim()] = values[i]?.trim(); });
                    return row;
                  });
                  result = await api.post<Any>(`/companies/${companyId}/payroll/periods/${period.id}/variables/import`, { source: 'csv', rows });
                }
                onDone(`${t('payroll.variables.imported')} : ${result.created} ${t('payroll.variables.createdCount')}, ${result.reused} ${t('payroll.variables.reusedCount')}`);
              } catch (err) { setError(errorMessage(err, t('common.error')).message); }
            })();
          }}>{t('payroll.variables.importAction')}</Button></div>
        </>
      )}
    </Modal>
  );
}

function PeriodModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const date = new Date();
  const [form, setForm] = useState({ year: String(date.getUTCFullYear()), month: String(date.getUTCMonth() + 1), paymentDate: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open title={t('payroll.period.new')} onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="form-grid">
        <Field label={t('payroll.period.year')}><input inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
        <Field label={t('payroll.period.month')}><input inputMode="numeric" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} /></Field>
        <Field label={t('payroll.period.payment')}><input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} /></Field>
      </div>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => {
        void (async () => {
          try {
            await api.post(`/companies/${companyId}/payroll/periods`, { year: Number(form.year), month: Number(form.month), paymentDate: form.paymentDate || undefined });
            onDone(t('payroll.period.created'));
          } catch (err) { setError(errorMessage(err, t('common.error')).message); }
        })();
      }}>{t('common.create')}</Button></div>
    </Modal>
  );
}

function EmployeeDetail({ employee, contracts, onClose }: { employee: Any; contracts: Any[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal open title={`${employee.employee_number} — ${employee.full_name}`} onClose={onClose} wide>
      <div className="payroll-detail-grid">
        <div><span className="muted">{t('payroll.job')}</span><strong>{read(employee.job_title)}</strong></div>
        <div><span className="muted">{t('payroll.department')}</span><strong>{read(employee.department)}</strong></div>
        <div><span className="muted">{t('payroll.location')}</span><strong>{read(employee.work_location)}</strong></div>
        <div><span className="muted">{t('payroll.nationality')}</span><strong>{read(employee.nationality)}</strong></div>
        <div><span className="muted">{t('payroll.birth')}</span><strong>{read(employee.date_of_birth)}</strong></div>
        <div><span className="muted">{t('payroll.hireDate')}</span><strong>{read(employee.hire_date)}</strong></div>
        <div><span className="muted">{t('payroll.emergency')}</span><strong>{read(employee.emergency_contact_name)}</strong></div>
        <div><span className="muted">{t('payroll.col.bank')}</span><strong>{employee.bankAccountMasked ?? '—'}</strong></div>
        <div><span className="muted">{t('payroll.statutoryId')}</span><strong>{employee.statutoryIdMasked ?? '—'}</strong></div>
      </div>
      <h3 className="payroll-h3">{t('payroll.contracts.title')}</h3>
      {contracts.length === 0 ? <p className="muted">{t('payroll.noContract')}</p> : (
        <div className="table-wrap"><table><thead><tr><th>{t('common.from')}</th><th>{t('common.to')}</th><th className="num">{t('payroll.col.salary')}</th><th>{t('common.status')}</th><th>{t('payroll.col.reason')}</th></tr></thead><tbody>{contracts.map((c) => <tr key={c.id}><td>{c.effective_from}</td><td>{read(c.effective_to)}</td><td className="num">{c.base_salary}</td><td><Badge kind={badgeKind(c.status)}>{c.status}</Badge></td><td className="small">{c.change_reason}</td></tr>)}</tbody></table></div>
      )}
      <p className="muted small">{t('payroll.detail.demoNotice')}</p>
    </Modal>
  );
}
