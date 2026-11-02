import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, qs } from '../../api';
import { translateError, useI18n } from '../../i18n';
import { useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Card, ErrorBanner, EmptyState, Spinner } from '../../components/ui';
import { AppIcon, type IconName } from '../../components/AppIcon';
import { date, dateTime, money } from '../../format';
import { ProgressBar, StepList, ONBOARDING_STEP_KEYS } from '../../components/cabinet/StepList';
import {
  KYC_STATUS_OPTIONS,
  MODULE_ICONS,
  availabilityBadge,
  kycCategoryLabelKey,
  statusKind,
  statusLabelKey,
  type ClientWorkspacePayload,
} from '../../cabinet/workspace';
import { MODULE_CATALOGUE, SECTORS } from '../../../../api/src/modules/cabinet-onboarding/catalogue';

const SECTIONS: { key: string; labelKey: string; icon: IconName }[] = [
  { key: 'overview', labelKey: 'm44.ws.overview', icon: 'dashboard' },
  { key: 'tasks', labelKey: 'm44.ws.tasks', icon: 'tasks' },
  { key: 'onboarding', labelKey: 'm44.ws.onboarding', icon: 'cabinet' },
  { key: 'accounting', labelKey: 'm44.ws.accounting', icon: 'accounting' },
  { key: 'sales', labelKey: 'm44.ws.sales', icon: 'sales' },
  { key: 'purchases', labelKey: 'm44.ws.purchases', icon: 'purchases' },
  { key: 'banking', labelKey: 'm44.ws.banking', icon: 'bank' },
  { key: 'payroll', labelKey: 'm44.ws.payroll', icon: 'payroll' },
  { key: 'assets', labelKey: 'm44.ws.assets', icon: 'assets' },
  { key: 'inventory', labelKey: 'm44.ws.inventory', icon: 'inventory' },
  { key: 'tax', labelKey: 'm44.ws.tax', icon: 'declarations' },
  { key: 'reports', labelKey: 'm44.ws.reports', icon: 'reports' },
  { key: 'documents', labelKey: 'm44.ws.documents', icon: 'documents' },
  { key: 'ai', labelKey: 'm44.ws.ai', icon: 'assistant' },
];

const MODULE_TO_SECTION: Record<string, string> = {
  onboarding_kyc: 'onboarding',
  sector_instances: 'onboarding',
  checks_balances: 'accounting',
  sales_einvoicing: 'sales',
  purchases_ocr: 'purchases',
  tax_management: 'tax',
  reports: 'reports',
  knowledge_ai: 'ai',
};

interface SectionLink {
  path: string;
  labelKey: string;
  prepared?: boolean;
}

const SECTION_LINKS: Record<string, SectionLink[]> = {
  accounting: [
    { path: '/accounting/accounts', labelKey: 'nav.accounts' },
    { path: '/accounting/entries', labelKey: 'nav.entries' },
    { path: '/accounting/ledger', labelKey: 'nav.ledger' },
    { path: '/accounting/trial-balance', labelKey: 'nav.trialBalance' },
    { path: '/accounting/controls', labelKey: 'nav.accounting.controls' },
    { path: '/accounting/accruals', labelKey: 'nav.accounting.accruals' },
    { path: '/accounting/provisions', labelKey: 'nav.accounting.provisions' },
    { path: '/accounting/financial-years', labelKey: 'nav.accounting.financialYears' },
    { path: '/accounting/multi-currency', labelKey: 'nav.accounting.multiCurrency' },
  ],
  sales: [
    { path: '/billing/customers', labelKey: 'nav.billing.customers' },
    { path: '/billing/quotes', labelKey: 'nav.billing.quotes' },
    { path: '/billing/invoices', labelKey: 'nav.billing.invoices' },
    { path: '/billing/credit-notes', labelKey: 'nav.billing.creditNotes' },
    { path: '/billing/payments', labelKey: 'nav.billing.payments' },
    { path: '/billing/aging', labelKey: 'nav.billing.aging' },
    { path: '/billing/e-invoicing', labelKey: 'nav.billing.eInvoicing', prepared: true },
  ],
  purchases: [
    { path: '/accounting/purchases', labelKey: 'nav.purchases.dashboard' },
    { path: '/accounting/purchases?tab=suppliers', labelKey: 'nav.purchases.suppliers' },
    { path: '/accounting/purchases?tab=invoices', labelKey: 'nav.purchases.invoices' },
    { path: '/accounting/purchases?tab=credit-notes', labelKey: 'nav.purchases.creditNotes' },
    { path: '/accounting/purchases?tab=payments', labelKey: 'nav.purchases.payments' },
    { path: '/documents', labelKey: 'm44.ws.ocr' },
    { path: '/cabinet/ai-proposals', labelKey: 'nav.cabinet.aiProposals' },
  ],
  banking: [
    { path: '/accounting/banking', labelKey: 'nav.bank.accounts' },
    { path: '/accounting/banking?tab=transactions', labelKey: 'nav.bank.reconciliation' },
    { path: '/accounting/banking?tab=import', labelKey: 'nav.bank.import' },
    { path: '/accounting/banking?tab=report', labelKey: 'nav.bank.periods' },
    { path: '/accounting/banking/bulk-reconciliation', labelKey: 'nav.bank.bulkReconciliation' },
  ],
  payroll: [
    { path: '/payroll', labelKey: 'nav.payroll.overview' },
    { path: '/payroll/employees', labelKey: 'nav.payroll.employees' },
    { path: '/payroll/payslips', labelKey: 'nav.payroll.payslips' },
    { path: '/payroll/transfer', labelKey: 'nav.payroll.transfer' },
    { path: '/payroll/declarations', labelKey: 'nav.payroll.declarations', prepared: true },
  ],
  assets: [
    { path: '/accounting/assets', labelKey: 'nav.accounting.assets' },
    { path: '/accounting/financial-years?tab=checklist', labelKey: 'nav.accounting.yearEndClosing' },
  ],
  inventory: [{ path: '/accounting/inventory', labelKey: 'nav.accounting.inventory' }],
  tax: [
    { path: '/accounting/settings', labelKey: 'nav.settings' },
    { path: '/cabinet/tasks', labelKey: 'nav.cabinet.tasks' },
    { path: '/accounting/statements', labelKey: 'nav.statements' },
  ],
  reports: [
    { path: '/accounting/trial-balance', labelKey: 'm44.reports.tb' },
    { path: '/accounting/ledger', labelKey: 'm44.reports.gl' },
    { path: '/accounting/statements/profit-loss', labelKey: 'm44.reports.pl' },
    { path: '/accounting/statements/balance-sheet', labelKey: 'm44.reports.bs' },
    { path: '/billing/aging', labelKey: 'm44.reports.ar' },
    { path: '/accounting/purchases?tab=aging', labelKey: 'm44.reports.ap' },
    { path: '/accounting/assets', labelKey: 'm44.reports.fa' },
    { path: '/accounting/inventory', labelKey: 'm44.reports.inv' },
    { path: '/accounting/settings?tab=vat', labelKey: 'm44.reports.vat', prepared: true },
  ],
  documents: [
    { path: '/documents', labelKey: 'nav.documents.archives' },
    { path: '/accounting/journals/purchases/import', labelKey: 'nav.documents.scan' },
    { path: '/cabinet/ai-proposals', labelKey: 'nav.cabinet.aiProposals' },
  ],
  ai: [
    { path: '/cabinet/ai-assistant', labelKey: 'nav.cabinet.ai' },
    { path: '/cabinet/settings/ai', labelKey: 'nav.cabinet.aiSettings' },
    { path: '/cabinet/ai-proposals', labelKey: 'nav.cabinet.aiProposals' },
  ],
};

/**
 * Mission 44 — Client workspace.
 *
 * One dossier, one header, one navigation. Every destination below opens an
 * existing COMPTAI screen after switching the active company, so the
 * multi-tenant isolation enforced by the API keeps applying. Availability is
 * stated for each of the eight functional domains requested by the accountant.
 */
export default function ClientWorkspacePage({ sectionOverride }: { sectionOverride?: string } = {}) {
  const { t, locale } = useI18n();
  const { companyId, section } = useParams();
  const activeSection = sectionOverride ?? section;
  const navigate = useNavigate();
  const { companies, company: activeCompany, setCompany } = useSession();
  const active = activeSection ?? 'overview';
  const { data, loading, error, reload } = useAsync<ClientWorkspacePayload | null>(
    () => (companyId ? api.get<ClientWorkspacePayload>(`/cabinet/workspace/clients/${companyId}`) : Promise.resolve(null)),
    [companyId],
  );

  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const companyNames = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name])),
    [companies],
  );

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error) return <EmptyState title={t('common.error')}>{error}</EmptyState>;
  if (!data || !companyId) return <EmptyState title={t('m44.ws.notFound')} />;

  const { company, onboarding, progress, checks } = data;
  const isActive = activeCompany?.id === company.id;

  const openInContext = (path: string) => {
    if (!isActive) setCompany(company.id);
    navigate(path);
  };

  const patchOnboarding = async (body: Record<string, unknown>) => {
    setSaving(true);
    setMessage(null);
    try {
      await api.patch(`/cabinet/workspace/clients/${company.id}/onboarding`, body);
      setMessage(t('m44.ws.saved'));
      await reload();
      return true;
    } catch (err) {
      setMessage(translateError((err as ApiError).code, (err as Error).message, t));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const patchKyc = async (key: string, status: string) => {
    setSaving(true);
    setMessage(null);
    try {
      await api.patch(`/cabinet/workspace/clients/${company.id}/onboarding/kyc/${key}`, { status });
      await reload();
    } catch (err) {
      setMessage(translateError((err as ApiError).code, (err as Error).message, t));
    } finally {
      setSaving(false);
    }
  };

  const stepView = progress.steps.map((step) => ({ key: step.key, status: step.status }));
  const initials = company.name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'CO';

  return (
    <>
      <div className="m46-ws-banner m44-client-head">
        <div className="m46-ws-identity">
          <span className="company-avatar company-avatar-lg" aria-hidden="true">
            {initials}
          </span>
          <div className="m46-ws-identity-copy">
            <div className="m44-kicker">{t('m44.workspace.kicker')}</div>
            <h1>{company.name}</h1>
            <div className="page-sub m44-client-meta">
              <span className="mono">{company.brn ?? t('m44.ws.noBrn')}</span>
              <Badge kind={data.sector ? 'violet' : 'neutral'}>
                {data.sector ? t(data.sector.labelKey) : t('m44.clients.noSector')}
              </Badge>
              <Badge kind="teal">{company.functional_currency}</Badge>
              <Badge kind={statusKind(onboarding.status)}>{t(statusLabelKey(onboarding.status))}</Badge>
              {isActive && <Badge kind="info">{t('m46.portfolio.activeCompanyTag')}</Badge>}
              <span>
                {t('m44.ws.financialYear')}: {date(company.financial_year_start, locale)} →{' '}
                {date(company.financial_year_end, locale)}
              </span>
              <span>
                {t('m44.ws.assigned')}:{' '}
                {onboarding.assigned_accountant_id
                  ? data.members.find((m) => m.user_id === onboarding.assigned_accountant_id)?.full_name ??
                    t('m44.clients.unassigned')
                  : t('m44.clients.unassigned')}
              </span>
            </div>
          </div>
        </div>
        <div className="m44-head-actions">
          <Link className="btn" to="/cabinet">
            <AppIcon name="back" size={16} /> {t('m44.ws.backToCabinet')}
          </Link>
          {!isActive && (
            <button className="btn" type="button" onClick={() => setCompany(company.id)}>
              {t('m44.ws.setActiveCompany', { name: company.name })}
            </button>
          )}
          <button className="btn btn-primary" type="button" onClick={() => openInContext('/accounting')}>
            <AppIcon name="accounting" size={16} /> {t('nav.group.accounting')}
          </button>
          <Link className="btn" to={`/cabinet/tasks${qs({ companyId: company.id })}`}>
            {t('m44.clients.viewTasks')}
          </Link>
        </div>
      </div>

      <div className="m44-ws-shell">
        <nav className="m44-ws-nav" aria-label={t('m44.ws.navAria')}>
          {SECTIONS.map((item) => (
            <Link
              key={item.key}
              to={`/cabinet/clients/${company.id}/workspace/${item.key}`}
              className={`m44-ws-nav-item ${active === item.key ? 'active' : ''}`}
              aria-current={active === item.key ? 'page' : undefined}
            >
              <AppIcon name={item.icon} size={16} />
              <span>{t(item.labelKey)}</span>
            </Link>
          ))}
        </nav>

        <div className="m44-ws-body">
          {message && <ErrorBanner message={message} />}

          {active === 'overview' && (
            <>
              <Card
                title={t('m44.ws.progressTitle')}
                actions={<span className="page-sub">{companyNames.get(company.id) === undefined ? '' : ''}</span>}
              >
                <div className="m44-overview-grid">
                  <div>
                    <ProgressBar percent={progress.percent} />
                    <p className="page-sub">
                      {t('m44.ws.progressDetail', {
                        done: progress.completedSteps,
                        total: progress.totalSteps,
                        percent: progress.percent,
                      })}
                    </p>
                    <p className="page-sub">{t('m44.ws.progressRule')}</p>
                    {progress.nextStep && (
                      <p>
                        {t('m44.ws.nextStep')} : <strong>{t(`m44.step.${progress.nextStep}`)}</strong>
                      </p>
                    )}
                    {progress.missingDocuments.length > 0 && (
                      <p className="m44-warning-text">
                        {t('m44.ws.missingDocs', { count: progress.missingDocuments.length })}
                      </p>
                    )}
                    <Link className="btn btn-sm btn-primary" to={`/cabinet/clients/${company.id}/workspace/onboarding`}>
                      {onboarding.status === 'approved'
                        ? t('m44.clients.reviewOnboarding')
                        : t('m44.clients.continueOnboarding')}
                    </Link>
                  </div>
                  <StepList steps={stepView} />
                </div>
              </Card>

              <Card title={t('m44.ws.domains')}>
                <div className="m44-domain-grid">
                  {data.moduleAvailability.map((module) => {
                    const badge = availabilityBadge(module.availability);
                    return (
                      <button
                        key={module.code}
                        type="button"
                        className="m44-domain-card"
                        onClick={() =>
                          navigate(
                            `/cabinet/clients/${company.id}/workspace/${MODULE_TO_SECTION[module.code] ?? 'overview'}`,
                          )
                        }
                      >
                        <span className="m44-domain-icon">
                          <AppIcon name={MODULE_ICONS[module.code] ?? 'reports'} size={20} />
                        </span>
                        <span className="m44-domain-text">
                          <strong>
                            {module.order}. {t(module.labelKey)}
                          </strong>
                          <span className="page-sub">{t(module.descriptionKey)}</span>
                          <span className="m44-domain-badges">
                            <Badge kind={badge.kind}>{t(badge.labelKey)}</Badge>
                            {!module.allowed && <Badge kind="danger">{t('m44.ws.noAccess')}</Badge>}
                            {module.selected ? (
                              <Badge kind="info">{t('m44.ws.selected')}</Badge>
                            ) : (
                              <Badge kind="neutral">{t('m44.ws.notSelected')}</Badge>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <div className="split">
                <Card title={t('m44.ws.checks')}>
                  <ul className="m44-check-list">
                    <li>
                      <span>{t('m44.checks.unposted')}</span>
                      <strong>{checks.unpostedEntries}</strong>
                    </li>
                    <li>
                      <span>{t('m44.checks.unbalanced')}</span>
                      <strong>{checks.unbalancedEntries}</strong>
                    </li>
                    <li>
                      <span>{t('m44.checks.trialBalance')}</span>
                      <Badge kind={checks.trialBalance.balanced ? 'success' : 'danger'}>
                        {checks.trialBalance.balanced ? t('m44.checks.balanced') : t('m44.checks.unbalancedTb')}
                      </Badge>
                    </li>
                    <li>
                      <span>{t('m44.checks.charges')}</span>
                      <span className="mono">
                        {money(checks.trialBalance.debit, locale, company.functional_currency)} /{' '}
                        {money(checks.trialBalance.credit, locale, company.functional_currency)}
                      </span>
                    </li>
                    <li>
                      <span>{t('m44.checks.opening')}</span>
                      <strong>{checks.openingBalanceBatches}</strong>
                    </li>
                    <li>
                      <span>{t('m44.checks.bank')}</span>
                      <strong>
                        {checks.bankAccounts} · {t('m44.checks.unreconciled', { count: checks.unreconciledTransactions })}
                      </strong>
                    </li>
                    <li>
                      <span>{t('m44.checks.pendingProposals')}</span>
                      <strong>{checks.pendingProposals}</strong>
                    </li>
                    <li>
                      <span>{t('m44.checks.missingDocs')}</span>
                      <strong>{checks.missingDocuments}</strong>
                    </li>
                  </ul>
                  <p className="page-sub">{t('m44.checks.note')}</p>
                  <button className="btn btn-sm" type="button" onClick={() => navigate(`/cabinet/clients/${company.id}/workspace/accounting`)}>
                    {t('m44.checks.open')}
                  </button>
                </Card>

                <Card title={t('m44.ws.tasksOpen')} actions={<Link to={`/cabinet/tasks${qs({ companyId: company.id })}`}>{t('m44.tasks.openAll')}</Link>}>
                  {data.tasks.length === 0 ? (
                    <p className="muted">{t('m44.ws.noTasks')}</p>
                  ) : (
                    <ul className="m44-task-list">
                      {data.tasks.slice(0, 8).map((task) => (
                        <li key={task.id}>
                          <div>
                            <strong>{task.title}</strong>
                            <div className="page-sub">
                              {t(`cabinet.tasks.category.${task.category}`)} ·{' '}
                              {t(statusLabelKey(task.status))}
                              {task.due_date ? ` · ${date(task.due_date, locale)}` : ''}
                            </div>
                          </div>
                          <span className="page-sub">{task.assignee_name ?? t('cabinet.tasks.unassigned')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <Card title={t('cabinet.activity')}>
                {data.recentActivity.length === 0 ? (
                  <p className="muted">{t('cabinet.noActivity')}</p>
                ) : (
                  <ul className="timeline">
                    {data.recentActivity.map((event) => (
                      <li key={event.id}>
                        <span className="timeline-dot" aria-hidden="true" />
                        <div>
                          <strong>{event.action}</strong>
                          <div className="page-sub">
                            {event.user_name ?? '—'} · {dateTime(event.created_at, locale)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}

          {active === 'onboarding' && (
            <OnboardingPanel
              data={data}
              saving={saving}
              onPatch={patchOnboarding}
              onKyc={patchKyc}
              onReload={() => void reload()}
            />
          )}

          {active === 'tasks' && (
            <Card title={t('m44.ws.tasks')} actions={<Link to={`/cabinet/tasks${qs({ companyId: company.id })}`}>{t('m44.tasks.openAll')}</Link>}>
              {data.tasks.length === 0 ? (
                <p className="muted">{t('m44.ws.noTasks')}</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('common.description')}</th>
                        <th>{t('cabinet.tasks.category')}</th>
                        <th>{t('common.status')}</th>
                        <th>{t('cabinet.dueDate')}</th>
                        <th>{t('cabinet.tasks.assignee')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tasks.map((task) => (
                        <tr key={task.id}>
                          <td>{task.title}</td>
                          <td>{t(`cabinet.tasks.category.${task.category}`)}</td>
                          <td>
                            <Badge kind={statusKind(task.status)}>{t(statusLabelKey(task.status))}</Badge>
                          </td>
                          <td className="mono">{task.due_date ? date(task.due_date, locale) : '—'}</td>
                          <td>{task.assignee_name ?? t('cabinet.tasks.unassigned')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {active !== 'overview' && active !== 'onboarding' && active !== 'tasks' && (
            <ModulePanel
              section={active}
              data={data}
              onOpen={openInContext}
              onOpenOnboarding={() => navigate(`/cabinet/clients/${company.id}/workspace/onboarding`)}
            />
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ module panel */

function ModulePanel({
  section,
  data,
  onOpen,
  onOpenOnboarding,
}: {
  section: string;
  data: ClientWorkspacePayload;
  onOpen: (path: string) => void;
  onOpenOnboarding: () => void;
}) {
  const { t } = useI18n();
  const links = SECTION_LINKS[section] ?? [];
  const moduleCode = Object.entries(MODULE_TO_SECTION).find(([, value]) => value === section)?.[0];
  const module = MODULE_CATALOGUE.find((m) => m.code === moduleCode);
  const availability = data.moduleAvailability.find((m) => m.code === moduleCode);
  const badge = availability ? availabilityBadge(availability.availability) : null;

  return (
    <>
      <Card title={t(SECTIONS.find((s) => s.key === section)?.labelKey ?? 'm44.ws.overview')}>
        {module && (
          <div className="m44-module-intro">
            <p className="page-sub">{t(module.descriptionKey)}</p>
            {badge && <Badge kind={badge.kind}>{t(badge.labelKey)}</Badge>}
            {availability && !availability.allowed && (
              <Badge kind="danger">{t('m44.ws.noAccess')}</Badge>
            )}
          </div>
        )}
        {links.length === 0 ? (
          <p className="muted">{t('m44.ws.noScreens')}</p>
        ) : (
          <ul className="m44-link-list">
            {links.map((link) => (
              <li key={link.path}>
                <button className="btn btn-sm" type="button" onClick={() => onOpen(link.path)}>
                  {t(link.labelKey)}
                </button>
                {link.prepared && <Badge kind="neutral">{t('module.prepared')}</Badge>}
              </li>
            ))}
          </ul>
        )}
        <p className="page-sub m44-context-note">{t('m44.ws.contextNote')}</p>
      </Card>

      {section === 'accounting' && (
        <Card title={t('m44.ws.checks')}>
          <ul className="m44-check-list">
            <li>
              <span>{t('m44.checks.unposted')}</span>
              <strong>{data.checks.unpostedEntries}</strong>
            </li>
            <li>
              <span>{t('m44.checks.unbalanced')}</span>
              <strong>{data.checks.unbalancedEntries}</strong>
            </li>
            <li>
              <span>{t('m44.checks.trialBalance')}</span>
              <Badge kind={data.checks.trialBalance.balanced ? 'success' : 'danger'}>
                {data.checks.trialBalance.balanced ? t('m44.checks.balanced') : t('m44.checks.unbalancedTb')}
              </Badge>
            </li>
            <li>
              <span>{t('m44.checks.accounts')}</span>
              <strong>{data.checks.accounts}</strong>
            </li>
            <li>
              <span>{t('m44.checks.posted')}</span>
              <strong>{data.checks.postedEntries}</strong>
            </li>
            <li>
              <span>{t('m44.checks.missingDocs')}</span>
              <strong>{data.checks.missingDocuments}</strong>
            </li>
          </ul>
          <p className="page-sub">{t('m44.checks.note')}</p>
          <button className="btn btn-sm" type="button" onClick={onOpenOnboarding}>
            {t('m44.ws.openOnboarding')}
          </button>
        </Card>
      )}

      {section === 'tax' && (
        <Card title={t('m44.tax.title')}>
          <p className="page-sub">{t('m44.tax.controlOnly')}</p>
          <ButtonRows onOpen={onOpen} />
        </Card>
      )}
    </>
  );
}

function ButtonRows({ onOpen }: { onOpen: (path: string) => void }) {
  const { t } = useI18n();
  const paths = [
    ['/accounting/settings', t('m44.tax.vatSettings')],
    ['/accounting/statements', t('m44.tax.vatControls')],
    ['/cabinet/tasks', t('m44.tax.tasks')],
  ] as const;
  return (
    <ul className="m44-link-list">
      {paths.map(([path, label]) => (
        <li key={path}>
          <button className="btn btn-sm" type="button" onClick={() => onOpen(path)}>
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------- onboarding panel */

function OnboardingPanel({
  data,
  saving,
  onPatch,
  onKyc,
  onReload,
}: {
  data: ClientWorkspacePayload;
  saving: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<boolean>;
  onKyc: (key: string, status: string) => Promise<void>;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const { onboarding } = data;
  const [sector, setSector] = useState(onboarding.sector ?? '');
  const [modules, setModules] = useState<string[]>(onboarding.selected_modules ?? []);
  const setup = (onboarding.accounting_setup ?? {}) as Record<string, unknown>;
  const [chartChoice, setChartChoice] = useState(String(setup.chartChoice ?? ''));
  const [openingChoice, setOpeningChoice] = useState(String(setup.openingBalanceChoice ?? ''));
  const [taxRegistration, setTaxRegistration] = useState(String(setup.taxRegistration ?? ''));
  const [bankReviewed, setBankReviewed] = useState(Boolean(setup.bankAccountsReviewed));
  const [sectorNotes, setSectorNotes] = useState(onboarding.sector_notes ?? '');

  const categories = [...new Set(data.kycChecks.map((c) => c.category))];
  const readOnly = data.role === 'viewer';

  return (
    <>
      <Card title={t('m44.onboarding.title')}>
        <div className="m44-overview-grid">
          <div>
            <StepList steps={data.progress.steps} />
          </div>
          <div>
            <p className="page-sub">{t('m44.onboarding.intro')}</p>
            <ProgressBar percent={data.progress.percent} />
            <p className="page-sub">
              {t('m44.ws.progressDetail', {
                done: data.progress.completedSteps,
                total: data.progress.totalSteps,
                percent: data.progress.percent,
              })}
            </p>
            <p className="page-sub">{t('m44.onboarding.notLegal')}</p>
          </div>
        </div>
      </Card>

      <Card title={t('m44.onboarding.sectorTitle')}>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t('m44.clients.sector')}</span>
            <select value={sector} onChange={(e) => setSector(e.target.value)} disabled={readOnly}>
              <option value="">{t('m44.clients.noSector')}</option>
              {SECTORS.map((item) => (
                <option key={item.key} value={item.key}>
                  {t(item.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('m44.sector.notes')}</span>
            <input value={sectorNotes} onChange={(e) => setSectorNotes(e.target.value)} disabled={readOnly} />
          </label>
        </div>
        {data.sector && <p className="page-sub">{t(data.sector.descriptionKey)}</p>}
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={saving || readOnly}
          onClick={() => void onPatch({ sector: sector || null, sectorNotes })}
        >
          {t('common.save')}
        </button>
      </Card>

      <Card title={t('m44.onboarding.modulesTitle')}>
        <ul className="m44-module-grid">
          {MODULE_CATALOGUE.map((module) => {
            const badge = availabilityBadge(module.availability);
            const selected = modules.includes(module.code);
            return (
              <li key={module.code} className={`m44-module-card ${selected ? 'selected' : ''}`}>
                <label className="m44-module-head">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={readOnly}
                    onChange={() =>
                      setModules((current) =>
                        current.includes(module.code)
                          ? current.filter((code) => code !== module.code)
                          : [...current, module.code],
                      )
                    }
                  />
                  <span>
                    <strong>
                      {module.order}. {t(module.labelKey)}
                    </strong>
                    <Badge kind={badge.kind}>{t(badge.labelKey)}</Badge>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={saving || readOnly}
          onClick={() => void onPatch({ selectedModules: modules })}
        >
          {t('common.save')}
        </button>
      </Card>

      <Card title={t('m44.onboarding.setupTitle')}>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t('m44.field.chartChoice')}</span>
            <select value={chartChoice} onChange={(e) => setChartChoice(e.target.value)} disabled={readOnly}>
              <option value="">{t('m44.setup.chart.provisional_template')}</option>
              <option value="provisional_template">{t('m44.setup.chart.provisional_template')}</option>
              <option value="import_later">{t('m44.setup.chart.import_later')}</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('m44.field.openingBalanceChoice')}</span>
            <select value={openingChoice} onChange={(e) => setOpeningChoice(e.target.value)} disabled={readOnly}>
              <option value="">{t('m44.setup.opening.later')}</option>
              <option value="existing_screen">{t('m44.setup.opening.existing_screen')}</option>
              <option value="later">{t('m44.setup.opening.later')}</option>
              <option value="not_applicable">{t('m44.setup.opening.not_applicable')}</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('m44.field.taxRegistration')}</span>
            <select
              value={taxRegistration}
              onChange={(e) => setTaxRegistration(e.target.value)}
              disabled={readOnly}
            >
              <option value="">{t('m44.setup.tax.to_confirm')}</option>
              <option value="registered">{t('m44.setup.tax.registered')}</option>
              <option value="not_registered">{t('m44.setup.tax.not_registered')}</option>
              <option value="to_confirm">{t('m44.setup.tax.to_confirm')}</option>
            </select>
          </label>
          <label className="m44-check">
            <input
              type="checkbox"
              checked={bankReviewed}
              disabled={readOnly}
              onChange={(e) => setBankReviewed(e.target.checked)}
            />
            <span>{t('m44.setup.bankReviewed')}</span>
          </label>
        </div>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={saving || readOnly}
          onClick={() =>
            void onPatch({
              accountingSetup: {
                accountingBasis: 'accrual',
                chartChoice: chartChoice || null,
                openingBalanceChoice: openingChoice || null,
                taxRegistration: taxRegistration || null,
                bankAccountsReviewed: bankReviewed,
              },
            })
          }
        >
          {t('common.save')}
        </button>
        <p className="page-sub">{t('m44.setup.reuse')}</p>
      </Card>

      <Card
        title={t('m44.onboarding.kycTitle')}
        actions={<Badge kind={statusKind(onboarding.kyc_review_status)}>{t(statusLabelKey(onboarding.kyc_review_status))}</Badge>}
      >
        <div className="alert alert-info" role="note">
          {t('m44.kyc.disclaimer')}
        </div>
        {data.kycChecks.length === 0 ? (
          <p className="muted">{t('m44.onboarding.kycEmpty')}</p>
        ) : (
          categories.map((category) => (
            <section key={category} className="m44-kyc-group">
              <h3>{t(kycCategoryLabelKey(category))}</h3>
              <ul className="m44-kyc-list">
                {data.kycChecks
                  .filter((check) => check.category === category)
                  .map((check) => {
                    const template = (data.catalogue.kycTemplate as any[]).find(
                      (item) => item.key === check.key,
                    );
                    return (
                      <li key={check.key}>
                        <div className="m44-kyc-label">
                          <strong>{template ? t(template.labelKey) : check.key}</strong>
                          {!check.required && <Badge kind="neutral">{t('m44.kyc.optional')}</Badge>}
                          {check.document_ref && <span className="page-sub">{check.document_ref}</span>}
                        </div>
                        <select
                          value={check.status}
                          aria-label={template ? t(template.labelKey) : check.key}
                          disabled={saving || readOnly}
                          onChange={(e) => void onKyc(check.key, e.target.value)}
                        >
                          {KYC_STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {t(statusLabelKey(status))}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))
        )}
        <div className="m44-wizard-actions">
          <button
            className="btn"
            type="button"
            disabled={saving}
            onClick={() => void onPatch({ kycReviewStatus: 'pending_review' })}
          >
            {t('m44.onboarding.submitReview')}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving}
            onClick={() => void onPatch({ kycReviewStatus: 'approved' })}
          >
            {t('m44.onboarding.approveKyc')}
          </button>
          <button
            className="btn btn-danger"
            type="button"
            disabled={saving}
            onClick={() => void onPatch({ kycReviewStatus: 'rejected' })}
          >
            {t('m44.onboarding.rejectKyc')}
          </button>
        </div>
      </Card>

      <Card title={t('m44.onboarding.activationTitle')}>
        <p className="page-sub">{t('m44.onboarding.activationHint')}</p>
        {data.progress.blockedSteps.length > 0 && (
          <div className="alert alert-error" role="alert">
            {t('m44.onboarding.blocked', { steps: data.progress.blockedSteps.map((s) => t(`m44.step.${s}`)).join(', ') })}
          </div>
        )}
        <div className="m44-wizard-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving || onboarding.status === 'approved'}
            onClick={() => void onPatch({ status: 'approved' })}
          >
            {onboarding.status === 'approved'
              ? t('m44.onboarding.activated')
              : t('m44.onboarding.activate')}
          </button>
          <button className="btn" type="button" onClick={onReload} disabled={saving}>
            {t('m44.refresh')}
          </button>
        </div>
        {onboarding.activated_at && (
          <p className="page-sub">{t('m44.onboarding.activatedAt')}</p>
        )}
      </Card>

      <p className="page-sub">{t('m44.onboarding.stepsHint', { steps: ONBOARDING_STEP_KEYS.length })}</p>
    </>
  );
}
