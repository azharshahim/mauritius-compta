import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Card, EmptyState, Spinner } from '../../components/ui';
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

export default function CabinetDashboardPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const { data, loading, error } = useAsync<CabinetDashboard | null>(
    () => api.get<CabinetDashboard>('/cabinet/dashboard'),
    [company?.id],
  );

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error) return <EmptyState title={t('common.error')}>{error}</EmptyState>;
  if (!data) return <EmptyState title={t('cabinet.dashboard.title')} />;

  const kpis: { key: string; label: string; value: number; tone?: 'danger' | 'warning' }[] = [
    { key: 'clients', label: t('cabinet.kpi.clients'), value: data.metrics.clients },
    { key: 'active', label: t('cabinet.kpi.active'), value: data.metrics.active },
    { key: 'archived', label: t('cabinet.kpi.archived'), value: data.metrics.archived },
    { key: 'toReview', label: t('cabinet.kpi.toReview'), value: data.metrics.toReview },
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
    { key: 'collaborators', label: t('cabinet.kpi.collaborators'), value: data.metrics.collaborators },
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

      <div className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.key} className={`kpi ${k.tone ? `kpi-${k.tone}` : ''}`}>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

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

        <Card title={t('cabinet.tasksByCategory')}>
          {data.tasksByCategory.length === 0 ? (
            <p className="muted">{t('cabinet.noUpcoming')}</p>
          ) : (
            <ul className="bar-list">
              {data.tasksByCategory.map((row) => {
                const max = Math.max(...data.tasksByCategory.map((r) => r.count), 1);
                return (
                  <li key={row.category}>
                    <span className="bar-label">{t(`cabinet.tasks.category.${row.category}`)}</span>
                    <span className="bar" style={{ width: `${(row.count / max) * 100}%` }} />
                    <span className="bar-value">{row.count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="split">
        <Card title={t('cabinet.dossiers')}>
          {data.dossiers.length === 0 ? (
            <p className="muted">{t('cabinet.companies.empty')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('cabinet.company')}</th>
                    <th>{t('cabinet.companies.clientCode')}</th>
                    <th>{t('cabinet.status')}</th>
                    <th>{t('cabinet.tasks.title')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dossiers.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link to={`/cabinet/companies/${d.id}`}>
                          <strong>{d.name}</strong>
                        </Link>
                      </td>
                      <td className="mono">{d.client_code ?? '—'}</td>
                      <td>
                        <Badge kind={d.status === 'active' ? 'success' : 'neutral'}>
                          {t(`companies.${d.status}`)}
                        </Badge>
                      </td>
                      <td>
                        {d.open_tasks} {t('cabinet.openTasksShort')}
                      </td>
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
