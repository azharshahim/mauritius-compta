import { useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Card, EmptyState, ErrorBanner, Spinner } from '../../components/ui';

interface Team {
  collaborators: {
    userId: string;
    fullName: string;
    email: string;
    isActive: boolean;
    assignments: { companyId: string; companyName: string; role: string }[];
  }[];
}

export default function TeamPage() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const { data, loading, error: loadError, reload } = useAsync<Team | null>(
    () => api.get<Team>('/cabinet/team'),
    [],
  );

  const changeRole = async (companyId: string, userId: string, role: string) => {
    setError(null);
    try {
      await api.patch(`/cabinet/companies/${companyId}/members/${userId}`, { role });
      await reload();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  if (loading) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('cabinet.team.title')}</h1>
          <div className="page-sub">{t('cabinet.team.sub')}</div>
        </div>
      </div>

      <ErrorBanner message={loadError ?? error} />
      <div className="banner banner-info">{t('cabinet.team.permissionsNote')}</div>

      {(data?.collaborators.length ?? 0) === 0 ? (
        <EmptyState title={t('cabinet.team.empty')} />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('cabinet.team.assignments')}</th>
                  <th>{t('cabinet.team.role')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.collaborators.map((person) => (
                  <tr key={person.userId}>
                    <td>
                      <strong>{person.fullName}</strong>
                      <div className="page-sub">{person.email}</div>
                      <Badge kind={person.isActive ? 'success' : 'danger'}>
                        {person.isActive ? t('cabinet.team.active') : t('cabinet.team.inactive')}
                      </Badge>
                    </td>
                    <td>
                      <ul className="plain-list">
                        {person.assignments.map((a) => (
                          <li key={a.companyId}>{a.companyName}</li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <ul className="plain-list">
                        {person.assignments.map((a) => (
                          <li key={a.companyId}>
                            <select
                              aria-label={`${t('cabinet.team.role')} ${a.companyName}`}
                              value={a.role}
                              onChange={(e) =>
                                void changeRole(a.companyId, person.userId, e.target.value)
                              }
                            >
                              <option value="cabinet_admin">{t('role.cabinet_admin')}</option>
                              <option value="manager">{t('role.manager')}</option>
                              <option value="accountant">{t('role.accountant')}</option>
                              <option value="billing_clerk">{t('role.billing_clerk')}</option>
                              <option value="payroll_manager">{t('role.payroll_manager')}</option>
                              <option value="viewer">{t('role.viewer')}</option>
                              {a.role === 'owner' && <option value="owner">{t('role.owner')}</option>}
                            </select>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
