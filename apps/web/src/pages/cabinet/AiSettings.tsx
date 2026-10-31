import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import { Badge, Button, Card, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { demoEnabled } from '../../demo';

interface ProviderView {
  key: string;
  label: string;
  requiresKey: boolean;
  docsUrl: string;
  notes: string;
  baseUrlConfigurable: boolean;
  baseUrl: string | null;
  models: { id: string; label: string }[];
  capabilities: { structuredOutput: string; vision: boolean; documents: boolean };
  configured: boolean;
  available: boolean;
  priceVerified: boolean;
}

interface UsageView {
  month: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string | null;
  costKnown: boolean;
  byProvider: { provider: string; model: string; requests: number; estimatedCostUsd: string | null }[];
  byModule: { module: string; requests: number }[];
  budget: {
    limitUsd: string | null;
    requestLimit: number | null;
    usedUsd: string | null;
    percent: number | null;
    state: 'ok' | 'warning' | 'exceeded' | 'unknown';
  };
}

interface SettingsView {
  cabinetId: string;
  enabled: boolean;
  routingMode: 'manual' | 'automatic';
  primary: { provider: string | null; model: string | null };
  fallback: { provider: string | null; model: string | null };
  monthlyBudgetUsd: string | null;
  monthlyRequestLimit: number | null;
  alertThreshold: number;
  features: Record<string, boolean>;
  encryptionReady: boolean;
  simulatedAvailable: boolean;
  providers: ProviderView[];
  usage: UsageView;
  catalogue?: { notice: string; priceRows: number };
}

const MODULES = ['accounting', 'billing', 'payroll', 'cabinet'] as const;

export default function AiSettingsPage() {
  const { t } = useI18n();
  const [view, setView] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    enabled: false,
    routingMode: 'manual' as 'manual' | 'automatic',
    primaryProvider: '',
    primaryModel: '',
    fallbackProvider: '',
    fallbackModel: '',
    monthlyBudgetUsd: '',
    monthlyRequestLimit: '',
    alertThreshold: 80,
    features: {} as Record<string, boolean>,
  });

  const [credentialProvider, setCredentialProvider] = useState<ProviderView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const apply = (data: SettingsView) => {
    setView(data);
    setForm({
      enabled: data.enabled,
      routingMode: data.routingMode,
      primaryProvider: data.primary.provider ?? '',
      primaryModel: data.primary.model ?? '',
      fallbackProvider: data.fallback.provider ?? '',
      fallbackModel: data.fallback.model ?? '',
      monthlyBudgetUsd: data.monthlyBudgetUsd ?? '',
      monthlyRequestLimit: data.monthlyRequestLimit === null ? '' : String(data.monthlyRequestLimit),
      alertThreshold: data.alertThreshold,
      features: { ...data.features },
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      apply(await api.get<SettingsView>('/cabinet/ai/settings'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providerOf = (key: string) => view?.providers.find((p) => p.key === key) ?? null;
  const primary = providerOf(form.primaryProvider);
  const fallback = providerOf(form.fallbackProvider);

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await api.patch<SettingsView>('/cabinet/ai/settings', {
        enabled: form.enabled,
        routingMode: form.routingMode,
        primary: form.primaryProvider
          ? { provider: form.primaryProvider, model: form.primaryModel || null }
          : null,
        fallback: form.fallbackProvider
          ? { provider: form.fallbackProvider, model: form.fallbackModel || null }
          : null,
        monthlyBudgetUsd: form.monthlyBudgetUsd === '' ? null : form.monthlyBudgetUsd,
        monthlyRequestLimit:
          form.monthlyRequestLimit === '' ? null : Number(form.monthlyRequestLimit),
        alertThreshold: form.alertThreshold,
        features: form.features,
      });
      apply(updated);
      setNotice(t('ai.settings.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    if (!credentialProvider) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/cabinet/ai/credentials/${credentialProvider.key}`, {
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
      });
      setCredentialProvider(null);
      setApiKey('');
      setBaseUrl('');
      setNotice(t('ai.keys.saved'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (provider: ProviderView) => {
    if (!window.confirm(t('ai.keys.deleteConfirm'))) return;
    setBusy(true);
    try {
      await api.del(`/cabinet/ai/credentials/${provider.key}`);
      setNotice(t('ai.keys.deleted'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async (provider: ProviderView) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; latencyMs: number; errorCode?: string }>(
        '/cabinet/ai/test-connection',
        { provider: provider.key, model: provider.models[0]?.id },
      );
      setNotice(
        res.ok
          ? `${t('ai.keys.testOk')} (${res.latencyMs} ms)`
          : `${t('ai.keys.testFailed')} — ${res.errorCode ?? 'AI_PROVIDER_ERROR'}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !view) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('ai.settings.title')}</h1>
          <div className="page-sub">{t('ai.settings.sub')}</div>
        </div>
        <Badge kind={view?.enabled ? 'success' : 'neutral'}>
          {view?.enabled ? t('ai.state.on') : t('ai.state.off')}
        </Badge>
      </div>

      {demoEnabled && <div className="banner banner-warning">{t('ai.demoNotice')}</div>}
      <ErrorBanner message={error} />
      {notice && <div className="alert alert-info">{notice}</div>}

      <Card title={t('ai.settings.engine')}>
        <div className="form-grid">
          <Field label={t('ai.settings.enabled')}>
            <select
              value={form.enabled ? 'yes' : 'no'}
              onChange={(e) => setForm({ ...form, enabled: e.target.value === 'yes' })}
            >
              <option value="no">{t('common.no')}</option>
              <option value="yes">{t('common.yes')}</option>
            </select>
          </Field>
          <Field label={t('ai.settings.routing')} hint={t('ai.settings.routingHint')}>
            <select
              value={form.routingMode}
              onChange={(e) =>
                setForm({ ...form, routingMode: e.target.value as 'manual' | 'automatic' })
              }
            >
              <option value="manual">{t('ai.settings.routing.manual')}</option>
              <option value="automatic">{t('ai.settings.routing.automatic')}</option>
            </select>
          </Field>
          <Field label={t('ai.settings.primary')}>
            <select
              value={form.primaryProvider}
              onChange={(e) => {
                const provider = providerOf(e.target.value);
                setForm({
                  ...form,
                  primaryProvider: e.target.value,
                  primaryModel: provider?.models[0]?.id ?? '',
                });
              }}
            >
              <option value="">{t('ai.settings.none')}</option>
              {view?.providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {p.requiresKey && !p.configured ? ` — ${t('ai.keys.missing')}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('ai.settings.model')}>
            <select
              value={form.primaryModel}
              onChange={(e) => setForm({ ...form, primaryModel: e.target.value })}
              disabled={!primary || primary.models.length === 0}
            >
              {(primary?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {primary && primary.models.length === 0 && <option value="">{t('ai.settings.modelFree')}</option>}
            </select>
          </Field>
          <Field label={t('ai.settings.fallback')}>
            <select
              value={form.fallbackProvider}
              onChange={(e) => {
                const provider = providerOf(e.target.value);
                setForm({
                  ...form,
                  fallbackProvider: e.target.value,
                  fallbackModel: provider?.models[0]?.id ?? '',
                });
              }}
            >
              <option value="">{t('ai.settings.none')}</option>
              {view?.providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('ai.settings.fallbackModel')}>
            <select
              value={form.fallbackModel}
              onChange={(e) => setForm({ ...form, fallbackModel: e.target.value })}
              disabled={!fallback || fallback.models.length === 0}
            >
              {(fallback?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="muted">{t('ai.settings.sharedPool')}</p>
      </Card>

      <Card title={t('ai.settings.budget')}>
        <div className="form-grid">
          <Field label={t('ai.settings.budgetUsd')} hint={t('ai.settings.budgetHint')}>
            <input
              inputMode="decimal"
              value={form.monthlyBudgetUsd}
              onChange={(e) => setForm({ ...form, monthlyBudgetUsd: e.target.value })}
              placeholder="—"
            />
          </Field>
          <Field label={t('ai.settings.requestLimit')} hint={t('ai.settings.requestLimitHint')}>
            <input
              inputMode="numeric"
              value={form.monthlyRequestLimit}
              onChange={(e) => setForm({ ...form, monthlyRequestLimit: e.target.value })}
              placeholder="—"
            />
          </Field>
          <Field label={t('ai.settings.alertThreshold')}>
            <input
              inputMode="numeric"
              value={String(form.alertThreshold)}
              onChange={(e) => setForm({ ...form, alertThreshold: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-label">{t('ai.usage.requests')}</div>
            <div className="kpi-value">{view?.usage.requests ?? 0}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{t('ai.usage.tokens')}</div>
            <div className="kpi-value">
              {(view?.usage.inputTokens ?? 0) + (view?.usage.outputTokens ?? 0)}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{t('ai.usage.cost')}</div>
            <div className="kpi-value">
              {view?.usage.costKnown
                ? `${view?.usage.estimatedCostUsd} USD`
                : t('ai.usage.costUnknown')}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{t('ai.usage.budgetState')}</div>
            <div className="kpi-value">
              <Badge
                kind={
                  view?.usage.budget.state === 'exceeded'
                    ? 'danger'
                    : view?.usage.budget.state === 'warning'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {t(`ai.usage.state.${view?.usage.budget.state ?? 'unknown'}`)}
              </Badge>
            </div>
          </div>
        </div>
        {!view?.usage.costKnown && <p className="muted">{t('ai.usage.noPrices')}</p>}
      </Card>

      <Button variant="primary" onClick={() => void save()} disabled={busy}>
        {t('common.save')}
      </Button>

      <Card title={t('ai.settings.modules')}>
        <p className="muted">{t('ai.settings.modulesHint')}</p>
        <div className="form-grid">
          {MODULES.map((module) => (
            <Field key={module} label={t(`module.${module}`)}>
              <select
                value={form.features[module] ? 'yes' : 'no'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    features: { ...form.features, [module]: e.target.value === 'yes' },
                  })
                }
              >
                <option value="no">{t('common.no')}</option>
                <option value="yes">{t('common.yes')}</option>
              </select>
            </Field>
          ))}
        </div>
      </Card>

      <Card title={t('ai.keys.title')}>
        {!view?.encryptionReady && !demoEnabled && (
          <div className="banner banner-warning">{t('ai.keys.notConfigured')}</div>
        )}
        {demoEnabled && <p className="muted">{t('ai.keys.demoExplain')}</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('ai.keys.provider')}</th>
                <th>{t('ai.keys.state')}</th>
                <th>{t('ai.keys.capabilities')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view?.providers.map((p) => (
                <tr key={p.key}>
                  <td>
                    <strong>{p.label}</strong>
                    <div className="page-sub">{p.notes}</div>
                  </td>
                  <td>
                    {p.configured ? (
                      <Badge kind="success">{t('ai.keys.configured')}</Badge>
                    ) : p.requiresKey ? (
                      <Badge kind="warning">{t('ai.keys.missing')}</Badge>
                    ) : (
                      <Badge>{t('ai.keys.notRequired')}</Badge>
                    )}
                  </td>
                  <td className="page-sub">
                    {p.capabilities.structuredOutput}
                    {p.capabilities.vision ? ' · vision' : ''}
                    {p.capabilities.documents ? ' · documents' : ''}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setCredentialProvider(p);
                          setApiKey('');
                          setBaseUrl(p.baseUrl ?? '');
                        }}
                        disabled={busy || demoEnabled}
                      >
                        {p.configured ? t('ai.keys.replace') : t('ai.keys.add')}
                      </Button>
                      {p.configured && p.requiresKey && (
                        <Button variant="ghost" onClick={() => void removeKey(p)} disabled={busy || demoEnabled}>
                          {t('ai.keys.delete')}
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => void testConnection(p)} disabled={busy}>
                        {t('ai.keys.test')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t('ai.usage.title')}>
        <p className="muted">{view?.catalogue?.notice}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('ai.keys.provider')}</th>
                <th>{t('ai.settings.model')}</th>
                <th>{t('ai.usage.requests')}</th>
                <th>{t('ai.usage.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {(view?.usage.byProvider ?? []).map((row) => (
                <tr key={`${row.provider}-${row.model}`}>
                  <td>{row.provider}</td>
                  <td className="mono">{row.model || '—'}</td>
                  <td>{row.requests}</td>
                  <td>
                    {row.estimatedCostUsd === null
                      ? t('ai.usage.costUnknown')
                      : `${row.estimatedCostUsd} USD`}
                  </td>
                </tr>
              ))}
              {(view?.usage.byProvider ?? []).length === 0 && (
                <tr>
                  <td colSpan={4}>{t('ai.usage.empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={credentialProvider !== null}
        title={credentialProvider ? `${t('ai.keys.add')} — ${credentialProvider.label}` : ''}
        onClose={() => setCredentialProvider(null)}
      >
        <ErrorBanner message={error} />
        <p className="muted">{t('ai.keys.security')}</p>
        <Field label={t('ai.keys.value')} hint={t('ai.keys.valueHint')}>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        {credentialProvider?.baseUrlConfigurable && (
          <Field label={t('ai.keys.baseUrl')} hint={t('ai.keys.baseUrlHint')}>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" />
          </Field>
        )}
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setCredentialProvider(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void saveKey()} disabled={busy || apiKey.length < 8}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
