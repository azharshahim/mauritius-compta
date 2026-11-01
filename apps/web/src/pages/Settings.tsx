import { useState } from 'react';
import { api } from '../api';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { errorMessage, useSession } from '../store';
import { useAsync } from '../hooks';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../components/ui';
import { date, dateTime } from '../format';

interface Period {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
}

interface Rate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate_date: string;
  rate: string;
  source: string;
}

interface Member {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface AuditEvent {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  user_email: string | null;
}

const CURRENCIES = ['MUR', 'EUR', 'USD', 'GBP'];
const SETTINGS_TABS = ['profile', 'company', 'periods', 'rates', 'members', 'audit'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const { company, user, updateUser } = useSession();
  // Mission 36: the active tab is part of the URL, so the sidebar can link
  // directly to Accounting periods or the Audit Trail.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab: SettingsTab = (SETTINGS_TABS as readonly string[]).includes(requestedTab ?? '')
    ? (requestedTab as SettingsTab)
    : 'profile';
  const setTab = (next: SettingsTab) => {
    const copy = new URLSearchParams(searchParams);
    copy.set('tab', next);
    setSearchParams(copy, { replace: true });
  };
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [periodForm, setPeriodForm] = useState({ name: '', startDate: '', endDate: '' });
  const [rateForm, setRateForm] = useState({
    fromCurrency: 'EUR',
    toCurrency: company?.functional_currency ?? 'MUR',
    rateDate: '',
    rate: '',
    source: '',
  });
  const [memberForm, setMemberForm] = useState({
    email: '',
    role: 'accountant',
    fullName: '',
    temporaryPassword: '',
  });

  const companyId = company?.id ?? '';
  const { data: companyDetail, reload: reloadCompany } = useAsync<{ periods: Period[] } | null>(
    () => (companyId ? api.get(`/companies/${companyId}`) : Promise.resolve(null)),
    [companyId],
  );
  const { data: rates, reload: reloadRates } = useAsync<{ rates: Rate[] } | null>(
    () => (companyId ? api.get(`/companies/${companyId}/exchange-rates`) : Promise.resolve(null)),
    [companyId],
  );
  const { data: members, reload: reloadMembers } = useAsync<{ members: Member[] } | null>(
    () =>
      companyId
        ? api
            .get<{ members: Member[] }>(`/companies/${companyId}/members`)
            .catch(() => null)
        : Promise.resolve(null),
    [companyId],
  );
  const { data: audit, reload: reloadAudit } = useAsync<{ events: AuditEvent[] } | null>(
    () =>
      companyId
        ? api
            .get<{ events: AuditEvent[] }>(`/companies/${companyId}/audit?limit=100`)
            .catch(() => null)
        : Promise.resolve(null),
    [companyId],
  );

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(t('settings.saved'));
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('settings.title')}</h1>
          <div className="page-sub">
            {company.name} · {t(`role.${company.role ?? 'owner'}`)}
          </div>
        </div>
      </div>
      <div className="alert alert-info">
        <Link to="/accounting/settings/company">{t('settings.company.link')}</Link>
        {' · '}
        <Link to="/accounting/settings/data">{t('settings.dataManagement.link')}</Link>
      </div>
      {message && <div className="alert alert-success">{message}</div>}
      <ErrorBanner message={error} />

      <div className="tabs">
        {(
          [
            ['profile', t('settings.profile')],
            ['company', t('settings.company')],
            ['periods', t('settings.periods')],
            ['rates', t('settings.rates')],
            ['members', t('settings.members')],
            ['audit', t('settings.audit')],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <Card title={t('settings.profile')}>
          <div className="form-grid">
            <Field label={t('login.email')}>
              <input value={user?.email ?? ''} disabled />
            </Field>
            <Field label={t('login.fullName')}>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run(() => updateUser({ fullName }).then(() => undefined))}
            >
              {t('common.save')}
            </Button>
          </div>
          <h3 style={{ margin: '10px 0' }}>{t('settings.changePassword')}</h3>
          <div className="form-grid">
            <Field label={t('settings.currentPassword')}>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label={t('settings.newPassword')} hint={t('settings.passwordHint')}>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <Button
            disabled={busy || !currentPassword || !newPassword}
            onClick={() =>
              void run(async () => {
                await updateUser({ currentPassword, newPassword });
                setCurrentPassword('');
                setNewPassword('');
              })
            }
          >
            {t('settings.changePassword')}
          </Button>
        </Card>
      )}

      {tab === 'company' && (
        <Card title={t('settings.company')}>
          <div className="table-wrap">
            <table>
              <tbody>
                {[
                  [t('common.name'), company.name],
                  [t('companies.brn'), company.brn ?? '—'],
                  [t('companies.vat'), company.vat_number ?? '—'],
                  [t('companies.address'), company.registered_address ?? '—'],
                  [t('companies.activity'), company.business_activity ?? '—'],
                  [
                    t('common.period'),
                    `${date(company.financial_year_start, locale)} → ${date(company.financial_year_end, locale)}`,
                  ],
                  [t('companies.functionalCurrency'), company.functional_currency],
                  [t('companies.presentationCurrency'), company.presentation_currency],
                  [t('companies.standard'), company.accounting_standard],
                  [t('companies.status'), t(`companies.${company.status}`)],
                ].map(([k, v]) => (
                  <tr key={k as string}>
                    <th style={{ width: 260 }}>{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {company.presentation_currency !== company.functional_currency && (
            <p className="page-sub" style={{ marginTop: 12 }}>
              {t('settings.presentationCurrencyHint')}
            </p>
          )}
          <p className="page-sub" style={{ marginTop: 12 }}>
            {t('accounts.demoNotice')}
          </p>
        </Card>
      )}

      {tab === 'periods' && (
        <Card title={t('settings.periods')}>
          <p className="page-sub">{t('settings.periodsHint')}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('settings.periodName')}</th>
                  <th>{t('settings.startDate')}</th>
                  <th>{t('settings.endDate')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(companyDetail?.periods ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{date(p.start_date, locale)}</td>
                    <td>{date(p.end_date, locale)}</td>
                    <td>
                      <Badge kind={p.status === 'open' ? 'success' : 'neutral'}>
                        {p.status === 'open' ? t('settings.open') : t('settings.closed')}
                      </Badge>
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api.post(
                                `/companies/${company.id}/periods/${p.id}/${p.status === 'open' ? 'close' : 'reopen'}`,
                              );
                              await reloadCompany();
                              await reloadAudit();
                            })
                          }
                        >
                          {p.status === 'open' ? t('settings.close') : t('settings.reopen')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ margin: '16px 0 8px' }}>{t('settings.newPeriod')}</h3>
          <div className="form-row">
            <Field label={t('settings.periodName')}>
              <input
                value={periodForm.name}
                onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
                placeholder="FY 2026/2027"
              />
            </Field>
            <Field label={t('settings.startDate')}>
              <input
                type="date"
                value={periodForm.startDate}
                onChange={(e) => setPeriodForm({ ...periodForm, startDate: e.target.value })}
              />
            </Field>
            <Field label={t('settings.endDate')}>
              <input
                type="date"
                value={periodForm.endDate}
                onChange={(e) => setPeriodForm({ ...periodForm, endDate: e.target.value })}
              />
            </Field>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.post(`/companies/${company.id}/periods`, periodForm);
                  setPeriodForm({ name: '', startDate: '', endDate: '' });
                  await reloadCompany();
                })
              }
            >
              {t('common.create')}
            </Button>
          </div>
        </Card>
      )}

      {tab === 'rates' && (
        <Card title={t('settings.rates')}>
          <p className="page-sub">{t('settings.noRates')}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.currency')}</th>
                  <th className="num">{t('settings.rate')}</th>
                  <th>{t('settings.rateSource')}</th>
                </tr>
              </thead>
              <tbody>
                {(rates?.rates ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>{date(r.rate_date, locale)}</td>
                    <td>
                      {r.from_currency} → {r.to_currency}
                    </td>
                    <td className="num mono">{r.rate}</td>
                    <td>{r.source}</td>
                  </tr>
                ))}
                {(rates?.rates ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="page-sub">
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h3 style={{ margin: '16px 0 8px' }}>{t('settings.addRate')}</h3>
          <div className="form-row">
            <Field label={t('common.from')}>
              <select
                value={rateForm.fromCurrency}
                onChange={(e) => setRateForm({ ...rateForm, fromCurrency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('common.to')}>
              <select
                value={rateForm.toCurrency}
                onChange={(e) => setRateForm({ ...rateForm, toCurrency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('settings.rateDate')}>
              <input
                type="date"
                value={rateForm.rateDate}
                onChange={(e) => setRateForm({ ...rateForm, rateDate: e.target.value })}
              />
            </Field>
            <Field label={t('settings.rate')}>
              <input
                inputMode="decimal"
                value={rateForm.rate}
                onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })}
                placeholder="48.5000"
              />
            </Field>
            <Field label={t('settings.rateSource')}>
              <input
                value={rateForm.source}
                onChange={(e) => setRateForm({ ...rateForm, source: e.target.value })}
                placeholder={t('settings.rateSourcePlaceholder')}
              />
            </Field>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.post(`/companies/${company.id}/exchange-rates`, rateForm);
                  setRateForm({ ...rateForm, rate: '', rateDate: '', source: '' });
                  await reloadRates();
                })
              }
            >
              {t('common.add')}
            </Button>
          </div>
        </Card>
      )}

      {tab === 'members' && (
        <Card title={t('settings.members')}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('settings.user')}</th>
                  <th>{t('settings.role')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(members?.members ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.full_name}
                      <div className="page-sub">{m.email}</div>
                    </td>
                    <td>{t(`role.${m.role}`)}</td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {m.id !== user?.id && (
                          <Button
                            variant="link"
                            onClick={() =>
                              void run(async () => {
                                await api.del(`/companies/${company.id}/members/${m.id}`);
                                await reloadMembers();
                              })
                            }
                          >
                            {t('common.remove')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ margin: '16px 0 8px' }}>{t('settings.addMember')}</h3>
          <div className="form-row">
            <Field label={t('login.email')}>
              <input
                type="email"
                value={memberForm.email}
                onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
              />
            </Field>
            <Field label={t('settings.role')}>
              <select
                value={memberForm.role}
                onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
              >
                <option value="admin">{t('role.admin')}</option>
                <option value="accountant">{t('role.accountant')}</option>
                <option value="viewer">{t('role.viewer')}</option>
              </select>
            </Field>
            <Field label={t('settings.temporaryPassword')} hint={t('settings.tempPasswordHint')}>
              <input
                type="password"
                value={memberForm.temporaryPassword}
                onChange={(e) => setMemberForm({ ...memberForm, temporaryPassword: e.target.value })}
              />
            </Field>
            <Button
              variant="primary"
              disabled={busy || !memberForm.email}
              onClick={() =>
                void run(async () => {
                  await api.post(`/companies/${company.id}/members`, {
                    email: memberForm.email,
                    role: memberForm.role,
                    temporaryPassword: memberForm.temporaryPassword || undefined,
                  });
                  setMemberForm({ email: '', role: 'accountant', fullName: '', temporaryPassword: '' });
                  await reloadMembers();
                })
              }
            >
              {t('common.add')}
            </Button>
          </div>
        </Card>
      )}

      {tab === 'audit' && (
        <Card title={t('settings.audit')}>
          {!audit ? (
            <Spinner />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('settings.date')}</th>
                    <th>{t('settings.user')}</th>
                    <th>{t('settings.action')}</th>
                    <th>{t('common.type')}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.events.map((e) => (
                    <tr key={e.id}>
                      <td>{dateTime(e.created_at, locale)}</td>
                      <td>{e.user_email ?? '—'}</td>
                      <td className="mono">{e.action}</td>
                      <td>{e.entity_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
