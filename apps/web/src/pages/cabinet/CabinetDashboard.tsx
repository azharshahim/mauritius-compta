import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Card, EmptyState, Spinner } from '../../components/ui';
import { AppIcon, type IconName } from '../../components/AppIcon';
import { date } from '../../format';

interface CabinetDashboard {
  metrics: {
    clients: number;
    active: number;
    archived: number;
    toReview: number;
    openTasks: number;
    overdueTasks: number;
    dueSoon: number;
    collaborators: number;
  };
  tasksByCategory: { category: string; count: number }[];
  upcoming: {
    id: string;
    title: string;
    category: string;
    priority: string;
    due_date: string;
    company_id: string;
    company_name: string;
    assignee_name: string | null;
  }[];
  recentActivity: {
    id: number;
    action: string;
    entity_type: string;
    created_at: string;
    company_name: string | null;
    user_name: string | null;
  }[];
  dossiers: {
    id: string;
    name: string;
    status: string;
    client_code: string | null;
    financial_year_end: string;
    open_tasks: number;
  }[];
}

interface CompanyOverview {
  kpis: { draftEntries: number };
}

interface DocumentRow {
  id: string;
  kind: 'purchase' | 'sale' | 'unknown';
  status: string;
}

export default function CabinetDashboardPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const { data, loading, error } = useAsync<CabinetDashboard | null>(
    () => api.get<CabinetDashboard>('/cabinet/dashboard'),
    [company?.id],
  );
  const { data: overview } = useAsync<CompanyOverview | null>(
    () => (company ? api.get<CompanyOverview>(`/companies/${company.id}/dashboard`) : Promise.resolve(null)),
    [company?.id],
  );
  const { data: documents } = useAsync<{ documents: DocumentRow[] } | null>(
    () => (company ? api.get<{ documents: DocumentRow[] }>(`/companies/${company.id}/documents`) : Promise.resolve(null)),
    [company?.id],
  );

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error) return <EmptyState title={t('common.error')}>{error}</EmptyState>;
  if (!data) return <EmptyState title={t('cabinet.dashboard.title')} />;

  const drafts = overview?.kpis.draftEntries ?? 0;
  const pendingDocuments = (documents?.documents ?? []).filter(
    (doc) => doc.status === 'EXTRACTED' || doc.status === 'PROPOSED',
  ).length;

  // Six essential indicators only. The remaining cabinet counters are kept in a
  // collapsed details block so the home screen stays usable on a phone.
  const kpis: { key: string; label: string; value: number; tone?: 'danger' | 'warning' }[] = [
    { key: 'active', label: t('cabinet.kpi.active'), value: data.metrics.active },
    { key: 'openTasks', label: t('cabinet.kpi.openTasks'), value: data.metrics.openTasks },
    {
      key: 'overdue',
      label: t('cabinet.kpi.overdue'),
      value: data.metrics.overdueTasks,
      tone: data.metrics.overdueTasks > 0 ? 'danger' : undefined,
    },
    {
      key: 'dueSoon',
      label: t('cabinet.kpi.dueSoon'),
      value: data.metrics.dueSoon,
      tone: data.metrics.dueSoon > 0 ? 'warning' : undefined,
    },
    { key: 'drafts', label: t('home.drafts'), value: drafts, tone: drafts > 0 ? 'warning' : undefined },
    {
      key: 'documents',
      label: t('home.pendingDocuments'),
      value: pendingDocuments,
      tone: pendingDocuments > 0 ? 'warning' : undefined,
    },
  ];

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('cabinet.dashboard.title')}</h1>
          <div className="page-sub">{t('cabinet.dashboard.sub')}</div>
        </div>
        <Link className="btn btn-primary" to="/cabinet/tasks">
          + {t('cabinet.tasks.new')}
        </Link>
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

      <div className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.key} className={`kpi ${k.tone ? `kpi-${k.tone}` : ''}`}>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      <Card title={t('home.quickAccess')}>
        <div className="quick-links">
          {([
            ['dashboard', t('nav.accounting.dashboard'), '/accounting'],
            ['purchases', t('nav.journals.purchases'), '/accounting/journals/purchases'],
            ['sales', t('nav.journals.sales'), '/accounting/journals/sales'],
            ['bank', t('nav.journals.bank'), '/accounting/journals/bank'],
            ['invoices', t('nav.billing.invoices'), '/billing/invoices'],
            ['trial', t('nav.trialBalance'), '/accounting/trial-balance'],
            ['reconciliation', t('nav.bank.reconciliation'), '/accounting/banking?tab=transactions'],
          ] as [IconName, string, string][]).map(([icon, label, to]) => (
            <Link to={to} key={to}>
              <AppIcon name={icon} size={16} /> {label}
            </Link>
          ))}
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="page-sub">{t('home.moreIndicators')}</summary>
          <div className="quick-links" style={{ marginTop: 8 }}>
            <span>{t('cabinet.kpi.clients')} : <strong>{data.metrics.clients}</strong></span>
            <span>{t('cabinet.kpi.archived')} : <strong>{data.metrics.archived}</strong></span>
            <span>{t('cabinet.kpi.toReview')} : <strong>{data.metrics.toReview}</strong></span>
            <span>{t('cabinet.kpi.collaborators')} : <strong>{data.metrics.collaborators}</strong></span>
          </div>
        </details>
      </Card>

      <div className="split">
        <Card title={t('cabinet.upcoming')}>
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
                    <th>{t('cabinet.tasks.assignee')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((task) => (
                    <tr key={task.id}>
                      <td className="mono">{date(task.due_date, locale)}</td>
                      <td>
                        <strong>{task.title}</strong>
                        <div className="page-sub">
                          {t(`cabinet.tasks.category.${task.category}`)} ·{' '}
                          {t(`cabinet.tasks.priority.${task.priority}`)}
                        </div>
                      </td>
                      <td>
                        <Link to={`/cabinet/companies/${task.company_id}`}>
                          {task.company_name}
                        </Link>
                      </td>
                      <td>{task.assignee_name ?? t('cabinet.tasks.unassigned')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('cabinet.activity')}>
          {data.recentActivity.length === 0 ? (
            <p className="muted">{t('cabinet.noActivity')}</p>
          ) : (
            <ul className="timeline">
              {data.recentActivity.map((a) => (
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
    </>
  );
}
