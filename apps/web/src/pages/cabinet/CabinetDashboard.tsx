import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { useAsync } from '../../hooks';
import { useViewportMode } from '../../responsive';
import { Badge, Card, EmptyState, KpiCard, Spinner } from '../../components/ui';
import type { KpiTone } from '../../components/ui';
import { AppIcon, type IconName } from '../../components/AppIcon';
import { date, dateTime } from '../../format';
import { statusKind, statusLabelKey, type WorkspaceClient, type WorkspacePayload } from '../../cabinet/workspace';

function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CO';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

/**
 * Mission 44 — COMPTAI Cabinet, Accountant Workspace.
 *
 * Portfolio first: seven indicators, a searchable client list with the actions
 * an accountant performs every morning, the drafts waiting to be resumed, then
 * the operational context (tasks, activity, quick links) kept from mission 38.
 * Every number comes from `/cabinet/workspace`; none is computed in the browser.
 */
export default function CabinetDashboardPage() {
  const { t, locale } = useI18n();
  const viewport = useViewportMode();
  const isMobile = viewport === 'mobile';
  const { company } = useSession();
  const { data, loading, error, reload } = useAsync<WorkspacePayload | null>(
    () => api.get<WorkspacePayload>('/cabinet/workspace'),
    [company?.id],
  );

  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('all');
  const [status, setStatus] = useState('all');
  const [accountant, setAccountant] = useState('all');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const hasActiveFilters =
    search.trim().length > 0 || sector !== 'all' || status !== 'all' || accountant !== 'all' || onlyAttention;
  const resetFilters = () => {
    setSearch('');
    setSector('all');
    setStatus('all');
    setAccountant('all');
    setOnlyAttention(false);
  };

  const clients = useMemo(() => {
    const list = data?.clients ?? [];
    const needle = search.trim().toLowerCase();
    return list.filter((client) => {
      if (sector !== 'all' && (client.sector ?? 'none') !== sector) return false;
      if (status !== 'all' && client.onboarding_status !== status) return false;
      if (accountant !== 'all' && (client.assigned_accountant_id ?? 'none') !== accountant) return false;
      if (
        onlyAttention &&
        client.missing_documents === 0 &&
        client.blocked_steps.length === 0 &&
        client.accounting_exceptions === 0
      ) {
        return false;
      }
      if (!needle) return true;
      return [client.name, client.trade_name, client.brn, client.client_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [data, search, sector, status, accountant, onlyAttention]);

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error) return <EmptyState title={t('common.error')}>{error}</EmptyState>;
  if (!data) return <EmptyState title={t('cabinet.dashboard.title')} />;

  const metrics = data.metrics;
  const kpis: { key: string; label: string; value: number; icon: IconName; tone: KpiTone; detail?: string }[] = [
    { key: 'total', label: t('m44.kpi.totalClients'), value: metrics.totalClients, icon: 'cabinet', tone: 'primary' },
    { key: 'active', label: t('m44.kpi.activeClients'), value: metrics.activeClients, icon: 'validate', tone: 'teal' },
    {
      key: 'drafts',
      label: t('home.drafts'),
      value: data.metricDetails.unpostedEntries,
      icon: 'journals',
      tone: data.metricDetails.unpostedEntries > 0 ? 'warning' : 'primary',
    },
    {
      key: 'pendingDocuments',
      label: t('home.pendingDocuments'),
      value: data.metricDetails.pendingDocuments,
      icon: 'documents',
      tone: data.metricDetails.pendingDocuments > 0 ? 'warning' : 'teal',
    },
    { key: 'onboarding', label: t('m44.kpi.onboarding'), value: metrics.onboardingInProgress, icon: 'tasks', tone: 'violet' },
    { key: 'reviews', label: t('m44.kpi.pendingReviews'), value: metrics.pendingReviews, icon: 'audit', tone: 'violet' },
    {
      key: 'documents',
      label: t('m44.kpi.missingDocuments'),
      value: metrics.missingDocuments,
      icon: 'ocr',
      tone: metrics.missingDocuments > 0 ? 'warning' : 'primary',
    },
    {
      key: 'exceptions',
      label: t('m44.kpi.accountingExceptions'),
      value: metrics.accountingExceptions,
      icon: 'alert',
      tone: metrics.accountingExceptions > 0 ? 'danger' : 'teal',
      detail:
        metrics.accountingExceptions > 0
          ? t('m44.kpi.exceptions.detail', {
              unposted: data.metricDetails.unpostedEntries,
              unbalanced: data.metricDetails.unbalancedEntries,
            })
          : undefined,
    },
    {
      key: 'tasks',
      label: t('cabinet.kpi.overdue'),
      value: metrics.overdueTasks,
      icon: 'aging',
      tone: metrics.overdueTasks > 0 ? 'danger' : 'primary',
    },
    {
      key: 'tax',
      label: t('m44.kpi.upcomingTax'),
      value: metrics.upcomingTaxTasks,
      icon: 'periods',
      tone: metrics.upcomingTaxTasks > 0 ? 'warning' : 'teal',
    },
  ];

  const canWrite = (client: WorkspaceClient) =>
    client.cabinet_access ? client.cabinet_access !== 'read' : true;

  return (
    <>
      <div className="page-head m44-workspace-head">
        <div className="grow">
          <div className="m44-kicker">{t('m44.workspace.kicker')}</div>
          <h1>{t('cabinet.dashboard.title')}</h1>
          <div className="page-sub">
            {data.cabinet?.name ?? t('m44.workspace.defaultCabinet')} · {data.user.fullName} ·{' '}
            {t('cabinet.dashboard.sub')}
          </div>
        </div>
        <div className="m44-head-actions">
          <Link className="btn btn-primary" to="/cabinet/clients/new">
            <AppIcon name="plus" size={16} /> {t('m44.createClient')}
          </Link>
          {company && (
            <Link className="btn" to={`/cabinet/clients/${company.id}/workspace`}>
              <AppIcon name="cabinet" size={16} /> {t('m46.shell.openWorkspace')}
            </Link>
          )}
          <Link className="btn" to="/cabinet/tasks">
            {t('cabinet.tasks.new')}
          </Link>
        </div>
      </div>

      <div className="context-strip">
        <div>
          <span>{t('home.activeCompany')}</span>
          <strong>{company?.name ?? t('common.none')}</strong>
        </div>
        <div>
          <span>{t('home.financialYear')}</span>
          <strong>
            {company ? `${date(company.financial_year_start, locale)} → ${date(company.financial_year_end, locale)}` : '—'}
          </strong>
        </div>
        <div>
          <span>{t('home.currency')}</span>
          <strong>{company?.functional_currency ?? '—'}</strong>
        </div>
        <div>
          <span>{t('common.status')}</span>
          <Badge kind={company?.status === 'active' ? 'success' : 'neutral'}>
            {company ? t(`companies.${company.status}`) : '—'}
          </Badge>
        </div>
      </div>

      <div className="kpi-grid m44-kpis">
        {kpis.map((k) => (
          <KpiCard
            key={k.key}
            label={k.label}
            value={k.value}
            detail={k.detail}
            icon={k.icon}
            tone={k.tone}
          />
        ))}
      </div>

      {data.drafts.length > 0 && (
        <Card title={t('m44.drafts.title')} className="m44-drafts">
          <p className="page-sub">{t('m44.drafts.sub')}</p>
          <ul className="m44-draft-list">
            {data.drafts.map((draft) => (
              <li key={draft.id}>
                <div>
                  <strong>{draft.registered_name ?? t('m44.drafts.unnamed')}</strong>
                  <div className="page-sub">
                    {t('m44.drafts.step', { step: draft.current_step })} ·{' '}
                    {dateTime(draft.updated_at, locale)}
                  </div>
                </div>
                <Link className="btn btn-sm" to={`/cabinet/clients/new?draft=${draft.id}`}>
                  {t('m44.drafts.resume')}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={t('m44.clients.title')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="page-sub">
              {t('m46.portfolio.showing')
                .replace('{shown}', String(clients.length))
                .replace('{total}', String(data.clients.length))}
            </span>
            {hasActiveFilters && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
                <AppIcon name="close" size={14} /> {t('m46.portfolio.resetFilters')}
              </button>
            )}
            {!isMobile && (
              <div className="view-toggle" role="group" aria-label={t('m44.clients.title')}>
                <button
                  type="button"
                  className={viewMode === 'table' ? 'active' : ''}
                  onClick={() => setViewMode('table')}
                >
                  <AppIcon name="table" size={14} /> {t('m46.portfolio.viewTable')}
                </button>
                <button
                  type="button"
                  className={viewMode === 'cards' ? 'active' : ''}
                  onClick={() => setViewMode('cards')}
                >
                  <AppIcon name="grid" size={14} /> {t('m46.portfolio.viewCards')}
                </button>
              </div>
            )}
          </div>
        }
        className="m44-clients"
      >
        <div className="m44-filters">
          <label className="field m44-search">
            <span className="field-label">{t('m44.clients.search')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('m44.clients.search.placeholder')}
              aria-label={t('m44.clients.search')}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('m44.clients.sector')}</span>
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              <option value="all">{t('common.all')}</option>
              {data.sectors.map((item) => (
                <option key={item.key} value={item.key}>
                  {t(item.labelKey)}
                </option>
              ))}
              <option value="none">{t('m44.clients.noSector')}</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('m44.clients.onboarding')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">{t('common.all')}</option>
              {[
                'not_started',
                'in_progress',
                'pending_review',
                'approved',
                'rejected',
              ].map((value) => (
                <option key={value} value={value}>
                  {t(statusLabelKey(value))}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('m44.clients.accountant')}</span>
            <select value={accountant} onChange={(event) => setAccountant(event.target.value)}>
              <option value="all">{t('common.all')}</option>
              {data.accountants.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
              <option value="none">{t('m44.clients.unassigned')}</option>
            </select>
          </label>
          <label className="m44-check">
            <input
              type="checkbox"
              checked={onlyAttention}
              onChange={(event) => setOnlyAttention(event.target.checked)}
            />
            <span>{t('m44.clients.onlyAttention')}</span>
          </label>
        </div>

        {clients.length === 0 ? (
          <EmptyState icon="cabinet" title={t('m44.clients.empty')}>
            <p className="page-sub">
              {data.clients.length === 0 ? t('m44.clients.emptyCabinet') : t('m44.clients.emptyFilters')}
            </p>
            {data.clients.length === 0 ? (
              <Link className="btn btn-primary" to="/cabinet/clients/new">
                <AppIcon name="plus" size={16} /> {t('m44.createClient')}
              </Link>
            ) : (
              <button type="button" className="btn btn-sm" onClick={resetFilters}>
                {t('m46.portfolio.resetFilters')}
              </button>
            )}
          </EmptyState>
        ) : (
          <>
            {!isMobile && viewMode === 'table' && (
              <div className="table-wrap m44-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('m44.clients.col.name')}</th>
                      <th>{t('m44.clients.col.brn')}</th>
                      <th>{t('m44.clients.col.sector')}</th>
                      <th>{t('m44.clients.col.accountant')}</th>
                      <th>{t('m44.clients.col.onboarding')}</th>
                      <th>{t('m44.clients.col.period')}</th>
                      <th>{t('m44.clients.col.tasks')}</th>
                      <th>{t('m44.clients.col.activity')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr key={client.id} className={company?.id === client.id ? 'company-row-current' : ''}>
                        <td>
                          <div className="m46-client-cell">
                            <span className="company-avatar" aria-hidden="true">
                              {companyInitials(client.name)}
                            </span>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <Link to={`/cabinet/clients/${client.id}/workspace`}>
                                  <strong>{client.name}</strong>
                                </Link>
                                {company?.id === client.id && (
                                  <Badge kind="teal">{t('m46.portfolio.activeCompanyTag')}</Badge>
                                )}
                              </div>
                              <div className="page-sub">
                                {client.trade_name ? `${client.trade_name} · ` : ''}
                                {client.client_code ?? '—'}
                                {client.status === 'archived' && <> · {t('companies.archived')}</>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="mono">{client.brn ?? '—'}</td>
                        <td>
                          <Badge kind={client.sector_label_key ? 'violet' : 'neutral'}>
                            {client.sector_label_key ? t(client.sector_label_key) : t('m44.clients.noSector')}
                          </Badge>
                        </td>
                        <td>{client.assigned_accountant_name ?? t('m44.clients.unassigned')}</td>
                        <td>
                          <Badge kind={statusKind(client.onboarding_status)}>
                            {t(statusLabelKey(client.onboarding_status))}
                          </Badge>
                          <div className="m44-progress" title={t('m44.clients.progress', { percent: client.progress_percent })}>
                            <span style={{ width: `${client.progress_percent}%` }} />
                          </div>
                          <div className="page-sub">
                            {t('m44.clients.progress', { percent: client.progress_percent })}
                            {client.missing_documents > 0 && (
                              <> · {t('m44.clients.missing', { count: client.missing_documents })}</>
                            )}
                          </div>
                        </td>
                        <td className="mono">
                          {date(client.financial_year_start, locale)}
                          <div className="page-sub">{date(client.financial_year_end, locale)}</div>
                        </td>
                        <td>
                          {client.open_tasks}
                          {client.tax_tasks > 0 && (
                            <div className="page-sub">
                              {t('m44.clients.taxTasks', { count: client.tax_tasks })}
                            </div>
                          )}
                          {client.blocked_steps.length > 0 && (
                            <div className="page-sub m44-danger-text">{t('m44.clients.blocked')}</div>
                          )}
                        </td>
                        <td className="mono">{client.last_activity_at ? dateTime(client.last_activity_at, locale) : '—'}</td>
                        <td>
                          <div className="m44-row-actions">
                            <Link className="btn btn-sm btn-primary" to={`/cabinet/clients/${client.id}/workspace`}>
                              {t('m44.clients.open')}
                            </Link>
                            <Link
                              className="btn btn-sm"
                              to={`/cabinet/clients/${client.id}/onboarding`}
                            >
                              {client.onboarding_status === 'approved'
                                ? t('m44.clients.reviewOnboarding')
                                : t('m44.clients.continueOnboarding')}
                            </Link>
                            <Link className="btn btn-sm" to={`/cabinet/tasks${qs({ companyId: client.id })}`}>
                              {t('m44.clients.viewTasks')}
                            </Link>
                            {canWrite(client) && (
                              <Link className="btn btn-sm" to={`/cabinet/companies/${client.id}`}>
                                {t('m44.clients.editDetails')}
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!isMobile && viewMode === 'cards' && (
              <ul className="m46-portfolio-grid">
                {clients.map((client) => (
                  <li
                    key={client.id}
                    className={`m46-portfolio-card${company?.id === client.id ? ' is-current' : ''}`}
                  >
                    <div className="m46-portfolio-card-top">
                      <span className="company-avatar" aria-hidden="true">
                        {companyInitials(client.name)}
                      </span>
                      <div className="m46-portfolio-card-title">
                        <Link to={`/cabinet/clients/${client.id}/workspace`}>
                          <strong>{client.name}</strong>
                        </Link>
                        <span className="page-sub">
                          {client.client_code ?? '—'} · {client.brn ?? '—'}
                        </span>
                      </div>
                      <Badge kind={statusKind(client.onboarding_status)}>
                        {t(statusLabelKey(client.onboarding_status))}
                      </Badge>
                    </div>
                    <div className="m46-alert-chips">
                      <Badge kind={client.sector_label_key ? 'violet' : 'neutral'}>
                        {client.sector_label_key ? t(client.sector_label_key) : t('m44.clients.noSector')}
                      </Badge>
                      {client.missing_documents > 0 && (
                        <Badge kind="warning">
                          {t('m44.clients.missing', { count: client.missing_documents })}
                        </Badge>
                      )}
                      {client.blocked_steps.length > 0 && (
                        <Badge kind="danger">{t('m44.clients.blocked')}</Badge>
                      )}
                    </div>
                    <div>
                      <div className="m44-progress">
                        <span style={{ width: `${client.progress_percent}%` }} />
                      </div>
                      <div className="page-sub">
                        {t('m44.clients.progress', { percent: client.progress_percent })} ·{' '}
                        {client.assigned_accountant_name ?? t('m44.clients.unassigned')}
                      </div>
                    </div>
                    <div className="m44-row-actions">
                      <Link className="btn btn-sm btn-primary" to={`/cabinet/clients/${client.id}/workspace`}>
                        {t('m44.clients.open')}
                      </Link>
                      <Link className="btn btn-sm" to={`/cabinet/clients/${client.id}/onboarding`}>
                        {client.onboarding_status === 'approved'
                          ? t('m44.clients.reviewOnboarding')
                          : t('m44.clients.continueOnboarding')}
                      </Link>
                      <Link className="btn btn-sm" to={`/cabinet/tasks${qs({ companyId: client.id })}`}>
                        {t('m44.clients.viewTasks')}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {isMobile && (
            <ul className="m44-client-cards">
              {clients.map((client) => (
                <li key={client.id} className="m44-client-card">
                  <div className="m44-client-card-head">
                    <Link to={`/cabinet/clients/${client.id}/workspace`}>
                      <strong>{client.name}</strong>
                    </Link>
                    <Badge kind={statusKind(client.onboarding_status)}>
                      {t(statusLabelKey(client.onboarding_status))}
                    </Badge>
                  </div>
                  <dl>
                    <div>
                      <dt>{t('m44.clients.col.sector')}</dt>
                      <dd>{client.sector_label_key ? t(client.sector_label_key) : t('m44.clients.noSector')}</dd>
                    </div>
                    <div>
                      <dt>{t('m44.clients.col.brn')}</dt>
                      <dd className="mono">{client.brn ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('m44.clients.col.period')}</dt>
                      <dd>
                        {date(client.financial_year_start, locale)} → {date(client.financial_year_end, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('m44.clients.col.tasks')}</dt>
                      <dd>{t('m44.clients.tasksSummary', { open: client.open_tasks, missing: client.missing_documents })}</dd>
                    </div>
                  </dl>
                  <div className="m44-progress">
                    <span style={{ width: `${client.progress_percent}%` }} />
                  </div>
                  <div className="page-sub">
                    {t('m44.clients.progress', { percent: client.progress_percent })} ·{' '}
                    {client.assigned_accountant_name ?? t('m44.clients.unassigned')}
                  </div>
                  <div className="m44-row-actions">
                    <Link className="btn btn-sm btn-primary" to={`/cabinet/clients/${client.id}/workspace`}>
                      {t('m44.clients.open')}
                    </Link>
                    <Link className="btn btn-sm" to={`/cabinet/clients/${client.id}/onboarding`}>
                      {client.onboarding_status === 'approved'
                        ? t('m44.clients.reviewOnboarding')
                        : t('m44.clients.continueOnboarding')}
                    </Link>
                    <Link className="btn btn-sm" to={`/cabinet/tasks${qs({ companyId: client.id })}`}>
                      {t('m44.clients.viewTasks')}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            )}
          </>
        )}
      </Card>

      <Card title={t('home.quickAccess')}>
        <div className="dashboard-quick-grid">
          {([
            ['accounts', t('nav.accounts'), '/accounting/accounts'],
            ['journals', t('nav.entries'), '/accounting/entries'],
            ['ledger', t('nav.ledger'), '/accounting/ledger'],
            ['trial', t('nav.trialBalance'), '/accounting/trial-balance'],
            ['audit', t('nav.accounting.controls'), '/accounting/controls'],
            ['reconciliation', t('nav.bank.reconciliation'), '/accounting/banking?tab=transactions'],
            ['periods', t('nav.bank.periods'), '/accounting/banking?tab=report'],
            ['profitLoss', t('nav.reports.profitLoss'), '/accounting/statements/profit-loss'],
            ['balanceSheet', t('nav.reports.balanceSheet'), '/accounting/statements/balance-sheet'],
            ['check', t('nav.accounting.yearEndClosing'), '/accounting/financial-years?tab=checklist'],
          ] as [IconName, string, string][]).map(([icon, label, to]) => (
            <Link className="dashboard-quick" to={to} key={to}>
              <AppIcon name={icon} size={17} /> <span>{label}</span>
            </Link>
          ))}
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="page-sub">{t('home.moreIndicators')}</summary>
          <div className="quick-links" style={{ marginTop: 8 }}>
            <span>{t('cabinet.kpi.clients')} : <strong>{metrics.totalClients}</strong></span>
            <span>{t('m44.kpi.overdueTasks')} : <strong>{data.metricDetails.unpostedEntries}</strong></span>
            <span>{t('m44.kpi.archived')} : <strong>{data.clients.filter((c) => c.status === 'archived').length}</strong></span>
            <span>{t('m44.kpi.unbalanced')} : <strong>{data.metricDetails.unbalancedEntries}</strong></span>
          </div>
        </details>
      </Card>

      <div className="split">
        <Card title={t('cabinet.upcoming')} actions={<Link to="/cabinet/tasks">{t('m44.tasks.openAll')}</Link>}>
          {data.upcoming.length === 0 ? (
            <p className="muted">{t('cabinet.noUpcoming')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('cabinet.dueDate')}</th>
                    <th>{t('common.description')}</th>
                    <th>{t('cabinet.company')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((task, index) => (
                    <tr key={task.id ?? `${task.title}-${index}`}>
                      <td className="mono">{date(task.due_date, locale)}</td>
                      <td>
                        <strong>{task.title}</strong>
                        {task.category && (
                          <div className="page-sub">
                            {t(`cabinet.tasks.category.${task.category}`)}
                            {task.priority ? ` · ${t(`cabinet.tasks.priority.${task.priority}`)}` : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        {task.company_id ? (
                          <Link to={`/cabinet/clients/${task.company_id}/workspace`}>{task.company_name}</Link>
                        ) : (
                          task.company_name
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.metrics.accountingExceptions > 0 && (
            <p className="page-sub m44-checks-note">{t('m44.kpi.exceptions.note')}</p>
          )}
        </Card>

        <Card title={t('cabinet.activity')}>
          {data.activity.length === 0 ? (
            <p className="muted">{t('cabinet.noActivity')}</p>
          ) : (
            <ul className="timeline">
              {data.activity.map((a) => (
                <li key={a.id}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div>
                    <div>
                      <strong>{a.action}</strong>{' '}
                      {a.company_name && <span className="muted">· {a.company_name}</span>}
                    </div>
                    <div className="page-sub">
                      {a.user_name ?? '—'} · {date(a.created_at, locale)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="page-sub m44-refresh">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
          <AppIcon name="refresh" size={15} /> {t('m44.refresh')}
        </button>
      </p>
    </>
  );
}
