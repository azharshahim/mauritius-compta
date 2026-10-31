import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { useSession, type Company } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Card, EmptyState, Spinner } from '../../components/ui';
import { date, dateTime } from '../../format';

interface Member {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  modules: Record<string, string>;
}

interface Task {
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_name: string | null;
}

interface Dossier {
  company: Company & {
    crn: string | null;
    client_code: string | null;
    dossier_manager_id: string | null;
    archived_at: string | null;
  };
  manager: { id: string; full_name: string; email: string } | null;
  role: string;
  modules: Record<string, string>;
  members: Member[];
  tasks: Task[];
  openTasks: Task[];
  recentActivity: {
    id: number;
    action: string;
    entity_type: string;
    created_at: string;
    user_name: string | null;
  }[];
  counts: { entries: number; accounts: number; openTasks: number; collaborators: number };
}

const OPEN_STATUSES = ['todo', 'in_progress', 'blocked'];

export default function DossierPage() {
  const { t, locale } = useI18n();
  const { companyId } = useParams<{ companyId: string }>();
  const { setCompany, company } = useSession();
  const { data, loading, error } = useAsync<Dossier | null>(
    () => (companyId ? api.get<Dossier>(`/cabinet/companies/${companyId}`) : Promise.resolve(null)),
    [companyId],
  );

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error || !data) return <EmptyState title={t('cabinet.dossier.notFound')}>{error ?? ''}</EmptyState>;

  const c = data.company;
  const modules = data.modules;
  const canOpen = (module: string) => (modules[module] ?? 'none') !== 'none';

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="page-sub">
            <Link to="/cabinet/companies">{t('cabinet.companies.title')}</Link> ·{' '}
            {t('cabinet.dossier.title')}
          </div>
          <h1>{c.name}</h1>
          <div className="page-sub">
            {c.client_code ? `${c.client_code} · ` : ''}
            {t('cabinet.companies.manager')} : {data.manager?.full_name ?? t('cabinet.companies.managerNone')}
          </div>
        </div>
        <Badge kind={c.status === 'active' ? 'success' : 'neutral'}>{t(`companies.${c.status}`)}</Badge>
        {company?.id !== c.id && (
          <button className="btn" onClick={() => setCompany(c.id)}>
            {t('cabinet.companies.select')}
          </button>
        )}
      </div>

      {c.status === 'archived' && (
        <div className="banner banner-warning">{t('error.COMPANY_ARCHIVED')}</div>
      )}

      <div className="split">
        <Card title={t('cabinet.dossier.info')}>
          <dl className="definition">
            <dt>{t('companies.brn')}</dt>
            <dd className="mono">{c.brn ?? '—'}</dd>
            <dt>{t('cabinet.companies.crn')}</dt>
            <dd className="mono">{c.crn ?? '—'}</dd>
            <dt>{t('companies.vat')}</dt>
            <dd className="mono">{c.vat_number ?? '—'}</dd>
            <dt>{t('companies.address')}</dt>
            <dd>{c.registered_address ?? '—'}</dd>
            <dt>{t('companies.activity')}</dt>
            <dd>{c.business_activity ?? '—'}</dd>
            <dt>{t('companies.functionalCurrency')}</dt>
            <dd>{c.functional_currency}</dd>
            <dt>{t('companies.fyStart')}</dt>
            <dd>
              {date(c.financial_year_start, locale)} → {date(c.financial_year_end, locale)}
            </dd>
            <dt>{t('cabinet.dossier.stats')}</dt>
            <dd>
              {data.counts.entries} {t('nav.entries').toLowerCase()} · {data.counts.accounts}{' '}
              {t('nav.accounts').toLowerCase()} · {data.counts.openTasks} {t('cabinet.openTasksShort')}
            </dd>
          </dl>
        </Card>

        <Card title={t('cabinet.dossier.links')}>
          <div className="link-list">
            <Link className={`btn ${canOpen('accounting') ? '' : 'disabled'}`} to="/accounting">
              📒 {t('cabinet.dossier.goAccounting')}
            </Link>
            <Link className={`btn ${canOpen('billing') ? '' : 'disabled'}`} to="/billing">
              🧾 {t('cabinet.dossier.goBilling')}
            </Link>
            <Link className={`btn ${canOpen('payroll') ? '' : 'disabled'}`} to="/payroll">
              👥 {t('cabinet.dossier.goPayroll')}
            </Link>
          </div>
          <p className="page-sub" style={{ marginTop: 12 }}>
            {t('cabinet.team.permissionsNote')}
          </p>
        </Card>
      </div>

      <div className="split">
        <Card title={t('cabinet.dossier.team')} actions={<Link to="/cabinet/team">{t('nav.cabinet.team')}</Link>}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('cabinet.team.role')}</th>
                  <th>{t('cabinet.team.modules')}</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.user_id}>
                    <td>
                      <strong>{m.full_name}</strong>
                      <div className="page-sub">{m.email}</div>
                    </td>
                    <td>
                      <Badge kind="info">{m.role}</Badge>
                      {!m.is_active && (
                        <>
                          {' '}
                          <Badge kind="danger">{t('cabinet.team.inactive')}</Badge>
                        </>
                      )}
                    </td>
                    <td className="mono">
                      {Object.entries(m.modules)
                        .filter(([, level]) => level !== 'none')
                        .map(([mod, level]) => `${mod}:${level}`)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={t('cabinet.dossier.openTasks')}
          actions={<Link to="/cabinet/tasks">{t('nav.cabinet.tasks')}</Link>}
        >
          {data.openTasks.length === 0 ? (
            <p className="muted">{t('cabinet.tasks.empty')}</p>
          ) : (
            <ul className="task-list">
              {data.openTasks.map((task) => (
                <li key={task.id}>
                  <Badge
                    kind={task.due_date && task.due_date < new Date().toISOString().slice(0, 10) ? 'danger' : 'neutral'}
                  >
                    {t(`cabinet.tasks.category.${task.category}`)}
                  </Badge>
                  <div className="grow">
                    <strong>{task.title}</strong>
                    <div className="page-sub">
                      {task.due_date ? date(task.due_date, locale) : '—'} ·{' '}
                      {task.assignee_name ?? t('cabinet.tasks.unassigned')}
                    </div>
                  </div>
                  <Badge kind={task.status === 'blocked' ? 'danger' : 'warning'}>
                    {t(`cabinet.tasks.status.${task.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('cabinet.dossier.activity')}>
        {data.recentActivity.length === 0 ? (
          <p className="muted">{t('cabinet.noActivity')}</p>
        ) : (
          <ul className="timeline">
            {data.recentActivity.map((a) => (
              <li key={a.id}>
                <span className="timeline-dot" aria-hidden="true" />
                <div>
                  <div>
                    <strong>{a.action}</strong> <span className="muted">· {a.entity_type}</span>
                  </div>
                  <div className="page-sub">
                    {a.user_name ?? '—'} · {dateTime(a.created_at, locale)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export { OPEN_STATUSES };
