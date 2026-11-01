import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Card } from '../../components/ui';
import { MODULES } from '../../modules';

interface Capabilities {
  available: boolean;
  capabilities: Record<string, boolean>;
  notice?: string;
}

/**
 * Space prepared but not implemented (Billing, Payroll, and the announced
 * accounting sub-features). Nothing is simulated: every capability is rendered
 * as "not available" until the corresponding engine exists.
 */
export default function PreparedPage({ module }: { module: 'billing' | 'payroll' | 'accounting' }) {
  const { t } = useI18n();
  const { company } = useSession();
  const location = useLocation();
  const definition = MODULES.find((m) => m.key === module)!;
  const item = definition.items.find((i) => i.to === location.pathname) ?? definition.items[0]!;

  const endpoint =
    module === 'billing'
      ? `/companies/${company?.id}/billing/summary`
      : module === 'payroll'
        ? `/companies/${company?.id}/payroll/summary`
        : null;

  const { data, error } = useAsync<Capabilities | null>(
    () => (endpoint && company ? api.get<Capabilities>(endpoint) : Promise.resolve(null)),
    [endpoint, company?.id],
  );

  const capabilities = data?.capabilities ?? {};

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="page-sub">{t(definition.labelKey)}</div>
          <h1>{t(item.key)}</h1>
        </div>
        <Badge kind="warning">{t('module.prepared')}</Badge>
      </div>

      <div className="banner banner-warning">{t('prepared.notAvailable')}</div>

      <div className="split">
        <Card title={t('prepared.title')}>
          <p>
            {module === 'billing'
              ? t('prepared.billingIntro')
              : module === 'payroll'
                ? t('prepared.payrollIntro')
                : t('prepared.architecture')}
          </p>
          {module === 'payroll' && <p className="page-sub">{t('prepared.payrollNoData')}</p>}
          {module === 'payroll' && (
            <p className="page-sub"><strong>{t('prepared.notAvailable')}</strong> — {t('prepared.payrollNotImplemented')}</p>
          )}
          {module === 'billing' && (
            <p className="page-sub"><strong>{t('prepared.notAvailable')}</strong> — {t('prepared.billingNotImplemented')}</p>
          )}
          {error && <p className="page-sub">{error}</p>}
        </Card>

        <Card title={t('prepared.capability')}>
          <ul className="capability-list">
            {Object.keys(capabilities).length === 0 && (
              <li className="muted">{t('prepared.architecture')}</li>
            )}
            {Object.entries(capabilities).map(([key, available]) => (
              <li key={key}>
                <span className="mono">{key}</span>
                <Badge kind={available ? 'success' : 'neutral'}>
                  {available ? t('prepared.available') : t('prepared.unavailable')}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={t('prepared.roadmap')}>
        <ul className="roadmap">
          {definition.items
            .filter((i) => i.prepared)
            .map((i) => (
              <li key={i.to} className={i.to === item.to ? 'current' : ''}>
                <Link to={i.to}>{t(i.key)}</Link>
                <span className="page-sub">{t('prepared.unavailable')}</span>
              </li>
            ))}
        </ul>
        {module === 'payroll' && (
          <p className="page-sub">
            {t('cabinet.team.permissionsNote')}
          </p>
        )}
        <Link className="btn" to="/accounting">
          {t('prepared.openAccounting')}
        </Link>
      </Card>
    </>
  );
}
