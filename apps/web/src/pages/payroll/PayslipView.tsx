import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadExport } from '../../api';
import { demoEnabled } from '../../demo/mode';
import { moneyExact, toScaled4 } from '../../format';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { ErrorBanner, Spinner } from '../../components/ui';

type Any = Record<string, any>;

const scaledString = (value: bigint) => {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 10_000n}.${String(abs % 10_000n).padStart(4, '0')}`;
};
const sumAmounts = (values: unknown[]) => {
  let total = 0n;
  for (const value of values) total += toScaled4(value as string) ?? 0n;
  return scaledString(total);
};

/**
 * Individual payslip view and dedicated browser print surface.
 *
 * In demo mode no server PDF exists: the browser print dialog is the only
 * output. The global shell is hidden by `styles.css` through the
 * `payslip-print-mode` body class, so menus, navigation, buttons and the AI
 * assistant never appear on paper.
 */
export default function PayslipViewPage() {
  const { payslipId } = useParams();
  const { company } = useSession();
  const { t, locale } = useI18n();
  const [payslip, setPayslip] = useState<Any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('payslip-print-mode');
    return () => document.body.classList.remove('payslip-print-mode');
  }, []);

  useEffect(() => {
    if (!company || !payslipId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<Any>(`/companies/${company.id}/payroll/payslips/${payslipId}`)
      .then((result) => { if (!cancelled) setPayslip(result.payslip); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err, t('common.error')).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [company?.id, payslipId, t]);

  if (loading && !payslip) return <Spinner label={t('common.loading')} />;
  if (!payslip) {
    return (
      <div className="no-print">
        <ErrorBanner message={error ?? t('payroll.payslip.notFound')} />
        <Link className="btn" to="/payroll/payslips">{t('common.back')}</Link>
      </div>
    );
  }

  const snapshot = payslip.snapshot ?? {};
  const totals = snapshot.totals ?? {};
  const employee = snapshot.employee ?? {};
  const period = snapshot.period ?? {};
  const contract = snapshot.contract ?? {};
  const companyInfo = snapshot.company ?? company ?? {};
  const currency = snapshot.currency ?? 'MUR';
  const lines: Any[] = snapshot.lines ?? [];
  const earnings = lines.filter((line) => ['base', 'earning', 'reimbursement'].includes(line.line_type));
  const otherDeductions = lines.filter((line) =>
    line.line_type === 'deduction' && !['PAYE', 'CSG_EE', 'NSF_EE'].includes(String(line.code)));
  const totalDeductions = sumAmounts([
    totals.deductions, totals.paye, totals.csgEmployee, totals.nsfEmployee,
  ]);
  const employerContributions = sumAmounts([
    totals.csgEmployer, totals.nsfEmployer, totals.trainingLevy,
  ]);
  const periodLabel = period.year
    ? `${String(period.month).padStart(2, '0')}/${period.year}`
    : '—';
  const label = (line: Any) => locale === 'fr' ? line.label_fr : line.label_en;
  const amount = (value: unknown) => moneyExact(value as string, locale, currency);
  const safety = [
    ...(snapshot.missingRules ?? []).map((rule: Any) => `${rule.ruleCode}: ${rule.reason ?? rule.status}`),
    ...(snapshot.warnings ?? []).map((warning: Any) => `${warning.code}: ${warning.message ?? ''}`),
  ];

  return (
    <div className="payslip-print-root">
      <div className="no-print payslip-actions">
        <Link className="btn btn-ghost" to="/payroll/payslips">← {t('common.back')}</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          {t('payroll.payslip.print')}
        </button>
        {!demoEnabled && (
          <button
            type="button"
            className="btn"
            onClick={() => void downloadExport(
              `/companies/${company!.id}/payroll/payslips/${payslip.id}/pdf`,
              `${payslip.payslip_no}.pdf`,
              'pdf',
            )}
          >
            {t('payroll.payslip.downloadPdf')}
          </button>
        )}
      </div>

      {demoEnabled && (
        <div className="no-print alert alert-info">{t('payroll.payslip.demoPrint')}</div>
      )}

      <article className="payslip-sheet" id="payslip-print">
        <header className="payslip-head">
          <div className="payslip-company">
            <h1>{companyInfo.name ?? t('common.company')}</h1>
            {companyInfo.registered_address && <p>{companyInfo.registered_address}</p>}
            {companyInfo.business_activity && <p>{companyInfo.business_activity}</p>}
            <p>
              {companyInfo.brn ? `BRN ${companyInfo.brn}` : ''}
              {companyInfo.contact_phone ? ` · ${companyInfo.contact_phone}` : ''}
              {companyInfo.contact_email ? ` · ${companyInfo.contact_email}` : ''}
            </p>
          </div>
          <div className="payslip-title">
            <h2>{t('payroll.payslip.title')}</h2>
            <p>{t('payroll.payslip.simulation')}</p>
            <strong>{payslip.payslip_no}</strong>
            <span>{t('common.status')}: {payslip.status}</span>
          </div>
        </header>

        <section className="payslip-identity">
          <div>
            <h3>{t('payroll.payslip.employee')}</h3>
            <p className="payslip-person">{employee.name ?? '—'}</p>
            <p>{t('payroll.col.number')}: {employee.number ?? '—'}</p>
            {employee.jobTitle && <p>{t('payroll.payslip.job')}: {employee.jobTitle}</p>}
            <p>{t('payroll.payslip.contract')}: {contract.type ?? '—'} · {contract.workPattern ?? '—'}</p>
            {employee.bankAccountMasked && <p>{t('payroll.payslip.bank')}: {employee.bankAccountMasked}</p>}
          </div>
          <div>
            <h3>{t('payroll.payslip.period')}</h3>
            <p className="payslip-person">{periodLabel}</p>
            <p>{period.start ?? '—'} — {period.end ?? '—'}</p>
            <p>{t('payroll.period.payment')}: {period.paymentDate ?? '—'}</p>
            <p>{t('payroll.payslip.currency')}: {currency}</p>
            <p>{t('payroll.payslip.reference')}: {snapshot.calculationReference ?? '—'}</p>
          </div>
        </section>

        <div className="payslip-tables">
          <section>
            <h3>{t('payroll.payslip.earnings')}</h3>
            <table>
              <thead><tr><th>{t('payroll.col.description')}</th><th className="num">{t('common.amount')}</th></tr></thead>
              <tbody>
                {earnings.map((line) => (
                  <tr key={`${line.line_no}-${line.code}`}>
                    <td>{label(line)}</td><td className="num">{amount(line.amount)}</td>
                  </tr>
                ))}
                <tr className="total"><th>{t('payroll.payslip.gross')}</th><th className="num">{amount(totals.gross)}</th></tr>
              </tbody>
            </table>
          </section>
          <section>
            <h3>{t('payroll.payslip.deductions')}</h3>
            <table>
              <thead><tr><th>{t('payroll.col.description')}</th><th className="num">{t('common.amount')}</th></tr></thead>
              <tbody>
                {otherDeductions.map((line) => (
                  <tr key={`${line.line_no}-${line.code}`}>
                    <td>{label(line)}</td><td className="num">{amount(line.amount)}</td>
                  </tr>
                ))}
                <tr><td>PAYE</td><td className="num">{amount(totals.paye)}</td></tr>
                <tr><td>CSG {t('payroll.payslip.employeeShort')}</td><td className="num">{amount(totals.csgEmployee)}</td></tr>
                <tr><td>NSF {t('payroll.payslip.employeeShort')}</td><td className="num">{amount(totals.nsfEmployee)}</td></tr>
                <tr className="total"><th>{t('payroll.payslip.totalDeductions')}</th><th className="num">{amount(totalDeductions)}</th></tr>
              </tbody>
            </table>
          </section>
        </div>

        <section className="payslip-net">
          <div><span>{t('payroll.payslip.netArithmetic')}</span><strong>{amount(totals.netArithmetic)}</strong></div>
          <div><span>{t('payroll.payslip.netAfterStatutory')}</span><strong>{amount(totals.netAfterStatutory)}</strong></div>
          <div className="payslip-net-payable"><span>{t('payroll.col.netPayable')}</span><strong>{t('common.notCalculated')}</strong></div>
          <p>{t('payroll.payslip.netBlocked')}</p>
        </section>

        <section>
          <h3>{t('payroll.payslip.employer')}</h3>
          <table className="payslip-employer-table">
            <tbody>
              <tr><td>CSG {t('payroll.payslip.employerShort')}</td><td className="num">{amount(totals.csgEmployer)}</td></tr>
              <tr><td>NSF {t('payroll.payslip.employerShort')}</td><td className="num">{amount(totals.nsfEmployer)}</td></tr>
              <tr><td>HRDC Training Levy</td><td className="num">{amount(totals.trainingLevy)}</td></tr>
              <tr><td>{t('payroll.payslip.employerContribTotal')}</td><td className="num">{amount(employerContributions)}</td></tr>
              <tr className="total"><th>{t('payroll.payslip.employerCost')}</th><th className="num">{amount(totals.employerCost)}</th></tr>
            </tbody>
          </table>
        </section>

        <section className="payslip-trace">
          <h3>{t('payroll.payslip.traceability')}</h3>
          <p>{t('payroll.payslip.statutoryStatus')}: {snapshot.statutoryStatus ?? '—'} · PAYE {snapshot.payeBasis ?? '—'} · v{snapshot.calculationVersion ?? 1}</p>
          {(snapshot.rulesApplied ?? []).map((rule: Any) => (
            <p key={`${rule.ruleCode}-${rule.version}`}>
              {rule.ruleCode} · v{rule.version} · {rule.status}
              {rule.sourceUrl ? ` · ${rule.sourceUrl}` : ''}
            </p>
          ))}
          {safety.length > 0 && <p>{t('payroll.payslip.controls')}: {safety.join(' | ')}</p>}
          <p>{t('payroll.payslip.generated')}: {snapshot.generatedAt ?? payslip.generated_at ?? '—'}</p>
        </section>

        <footer className="payslip-foot">
          <strong>{t('payroll.payslip.footer')}</strong>
          <span>{payslip.payslip_no} · {t('payroll.payslip.page')} 1</span>
        </footer>
      </article>
    </div>
  );
}
