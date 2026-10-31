import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, ErrorBanner, Field, Spinner } from '../../components/ui';

/**
 * Paramètres société (mission 7) — référentiel unique.
 *
 * Le même écran est ouvert depuis Cabinet → Sociétés → Fiche société →
 * Paramètres et depuis Comptabilité → Paramètres société. Il lit et écrit le
 * même référentiel que la fiche société : aucune duplication, aucune copie.
 *
 * Les changements importants sont journalisés côté serveur, et un taux de TVA
 * ne peut être marqué « vérifié » qu'avec une source documentée et une
 * confirmation explicite d'un humain autorisé.
 */

type Treatment = 'taxable' | 'zero_rated' | 'exempt' | 'out_of_scope';

interface SettingsView {
  company: { id: string; status: string };
  identification: {
    name: string;
    tradeName: string | null;
    brn: string | null;
    vatNumber: string | null;
    registeredAddress: string | null;
    businessActivity: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    locale: 'fr' | 'en';
  };
  accounting: {
    functionalCurrency: string;
    presentationCurrency: string;
    accountingStandard: string;
    financialYearStart: string;
    financialYearEnd: string;
    journals: { id: string; code: string; name: string; type: string; is_active: boolean }[];
    periods: { id: string; name: string; start_date: string; end_date: string; status: string }[];
    defaultAccounts: Record<string, string | null> | null;
  };
  billing: {
    quotePrefix: string;
    invoicePrefix: string;
    creditPrefix: string;
    numberingPolicy: 'yearly' | 'continuous';
    defaultPaymentTerms: number;
    defaultCurrency: string;
    documentLanguage: 'fr' | 'en';
    logoUrl: string | null;
    legalFooterFr: string | null;
    legalFooterEn: string | null;
    bankDetails: string | null;
    defaultRevenueAccountId: string | null;
    defaultReceivableAccountId: string | null;
    defaultBankAccountId: string | null;
    defaultPurchaseAccountId: string | null;
    defaultVatInputAccountId: string | null;
    defaultVatOutputAccountId: string | null;
  } | null;
  tax: {
    vatEnabled: boolean;
    vatNumber: string | null;
    rates: TaxRate[];
    verifiedCount: number;
    unverifiedCount: number;
    notice: string;
  };
  chartOfAccounts: { id: string; code: string; name: string; type: string; is_active: boolean }[];
  history: { id: string; action: string; details: unknown; createdAt: string }[];
  permissions: {
    canEditIdentification: boolean;
    canEditAccounting: boolean;
    canEditBilling: boolean;
    canEditTax: boolean;
  };
}

interface TaxRate {
  id: string;
  code: string;
  label: string;
  rate: string;
  treatment: Treatment;
  effectiveFrom: string;
  effectiveTo: string | null;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  source: string | null;
  notes: string | null;
  vatAccountId: string | null;
}

type Tab = 'identification' | 'accounting' | 'billing' | 'tax';

const TREATMENTS: { key: Treatment; fr: string; en: string }[] = [
  { key: 'taxable', fr: 'Taxable', en: 'Taxable' },
  { key: 'zero_rated', fr: 'Taux zéro (zero-rated)', en: 'Zero-rated' },
  { key: 'exempt', fr: 'Exonéré (exempt)', en: 'Exempt' },
  { key: 'out_of_scope', fr: 'Hors champ (out of scope)', en: 'Out of scope' },
];

const emptyForm = {
  code: '',
  label: '',
  rate: '15',
  treatment: 'taxable' as Treatment,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '',
  source: '',
  vatAccountId: '',
};

export default function CompanySettingsPage() {
  const { companyId: routeCompanyId } = useParams<{ companyId: string }>();
  const { company } = useSession();
  const companyId = routeCompanyId ?? company?.id ?? '';
  const { t, locale } = useI18n();

  const [tab, setTab] = useState<Tab>('identification');
  const [view, setView] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [identification, setIdentification] = useState<SettingsView['identification'] | null>(null);
  const [accounting, setAccounting] = useState<SettingsView['accounting'] | null>(null);
  const [billing, setBilling] = useState<NonNullable<SettingsView['billing']> | null>(null);
  const [commercial, setCommercial] = useState({ vatEnabled: false, vatNumber: '' });

  const [rateForm, setRateForm] = useState({ ...emptyForm });
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [verifyForm, setVerifyForm] = useState({ source: '', confirm: false });
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, { id: string; action: string; createdAt: string }[]>>({});

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SettingsView>(`/companies/${companyId}/settings/company`);
      setView(data);
      setIdentification(data.identification);
      setAccounting(data.accounting);
      setBilling(data.billing);
      setCommercial({ vatEnabled: data.tax.vatEnabled, vatNumber: data.tax.vatNumber ?? '' });
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = useMemo(() => view?.chartOfAccounts ?? [], [view]);
  const can = view?.permissions;

  const save = async (path: string, payload: Record<string, unknown>, doneKey: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/companies/${companyId}/${path}`, payload);
      setNotice(t(doneKey));
      await load();
    } catch (err) {
      const info = errorMessage(err, t('common.error'));
      setError(info.message);
    } finally {
      setBusy(false);
    }
  };

  if (!companyId) return <ErrorBanner message={t('settings.noCompany')} />;
  if (loading && !view) return <Spinner label={t('common.loading')} />;
  if (!view || !identification || !accounting) {
    return <ErrorBanner message={error ?? t('common.error')} />;
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="breadcrumb">
            <Link to="/cabinet/companies">{t('cabinet.companies.title')}</Link> ·{' '}
            <Link to={`/cabinet/companies/${companyId}`}>{identification.name}</Link> ·{' '}
            {t('settings.company.title')}
          </div>
          <h1>{t('settings.company.title')}</h1>
          <p className="muted">{t('settings.company.subtitle')}</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && <div className="alert alert-info">{notice}</div>}

      <nav className="tabs" aria-label={t('settings.company.sections')}>
        {(
          [
            ['identification', t('settings.company.identification')],
            ['accounting', t('settings.company.accounting')],
            ['billing', t('settings.company.billing')],
            ['tax', t('settings.company.tax')],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'identification' && (
        <Card title={t('settings.company.identification')}>
          <div className="grid-2">
            <Field label={t('settings.company.name')}>
              <input
                value={identification.name}
                onChange={(e) => setIdentification({ ...identification, name: e.target.value })}
                disabled={!can?.canEditIdentification}
                maxLength={200}
              />
            </Field>
            <Field label={t('settings.company.tradeName')}>
              <input
                value={identification.tradeName ?? ''}
                onChange={(e) => setIdentification({ ...identification, tradeName: e.target.value })}
                disabled={!can?.canEditIdentification}
              />
            </Field>
            <Field label="BRN">
              <input
                value={identification.brn ?? ''}
                onChange={(e) => setIdentification({ ...identification, brn: e.target.value })}
                disabled={!can?.canEditIdentification}
              />
            </Field>
            <Field label={t('settings.company.vatNumber')}>
              <input
                value={identification.vatNumber ?? ''}
                onChange={(e) => setIdentification({ ...identification, vatNumber: e.target.value })}
                disabled={!can?.canEditIdentification}
              />
            </Field>
            <Field label={t('settings.company.contactName')}>
              <input
                value={identification.contactName ?? ''}
                onChange={(e) => setIdentification({ ...identification, contactName: e.target.value })}
                disabled={!can?.canEditIdentification}
              />
            </Field>
            <Field label={t('settings.company.contactEmail')}>
              <input
                type="email"
                value={identification.contactEmail ?? ''}
                onChange={(e) => setIdentification({ ...identification, contactEmail: e.target.value })}
                disabled={!can?.canEditIdentification}
              />
            </Field>
            <Field label={t('settings.company.contactPhone')}>
              <input
                value={identification.contactPhone ?? ''}
                onChange={(e) => setIdentification({ ...identification, contactPhone: e.target.value })}
                disabled={!can?.canEditIdentification}
              />
            </Field>
            <Field label={t('settings.company.locale')}>
              <select
                value={identification.locale}
                onChange={(e) =>
                  setIdentification({ ...identification, locale: e.target.value as 'fr' | 'en' })
                }
                disabled={!can?.canEditIdentification}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
          <Field label={t('settings.company.address')}>
            <textarea
              rows={2}
              value={identification.registeredAddress ?? ''}
              onChange={(e) => setIdentification({ ...identification, registeredAddress: e.target.value })}
              disabled={!can?.canEditIdentification}
            />
          </Field>
          <Field label={t('settings.company.activity')}>
            <input
              value={identification.businessActivity ?? ''}
              onChange={(e) => setIdentification({ ...identification, businessActivity: e.target.value })}
              disabled={!can?.canEditIdentification}
            />
          </Field>
          <Button
            disabled={!can?.canEditIdentification || busy}
            onClick={() =>
              void save(
                'settings/identification',
                {
                  name: identification.name,
                  tradeName: identification.tradeName,
                  brn: identification.brn,
                  vatNumber: identification.vatNumber,
                  registeredAddress: identification.registeredAddress,
                  businessActivity: identification.businessActivity,
                  contactName: identification.contactName,
                  contactEmail: identification.contactEmail,
                  contactPhone: identification.contactPhone,
                  locale: identification.locale,
                },
                'settings.company.saved',
              )
            }
          >
            {t('common.save')}
          </Button>
        </Card>
      )}

      {tab === 'accounting' && (
        <>
          <Card title={t('settings.company.accounting')}>
            <div className="grid-2">
              <Field label={t('settings.company.functionalCurrency')}>
                <input value={accounting.functionalCurrency} disabled />
              </Field>
              <Field label={t('settings.company.presentationCurrency')}>
                <input
                  value={accounting.presentationCurrency}
                  onChange={(e) => setAccounting({ ...accounting, presentationCurrency: e.target.value.toUpperCase() })}
                  disabled={!can?.canEditAccounting}
                  maxLength={3}
                />
              </Field>
              <Field label={t('settings.company.fyStart')}>
                <input
                  type="date"
                  value={accounting.financialYearStart.slice(0, 10)}
                  onChange={(e) => setAccounting({ ...accounting, financialYearStart: e.target.value })}
                  disabled={!can?.canEditAccounting}
                />
              </Field>
              <Field label={t('settings.company.fyEnd')}>
                <input
                  type="date"
                  value={accounting.financialYearEnd.slice(0, 10)}
                  onChange={(e) => setAccounting({ ...accounting, financialYearEnd: e.target.value })}
                  disabled={!can?.canEditAccounting}
                />
              </Field>
            </div>
            <p className="muted small">{t('settings.company.fyRule')}</p>
            <Button
              disabled={!can?.canEditAccounting || busy}
              onClick={() =>
                void save(
                  'settings/accounting',
                  {
                    financialYearStart: accounting.financialYearStart.slice(0, 10),
                    financialYearEnd: accounting.financialYearEnd.slice(0, 10),
                    presentationCurrency: accounting.presentationCurrency,
                  },
                  'settings.company.saved',
                )
              }
            >
              {t('common.save')}
            </Button>
          </Card>
          <Card title={t('settings.company.periods')}>
            {accounting.periods.length === 0 ? (
              <p className="muted">{t('common.none')}</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('settings.company.period')}</th>
                    <th>{t('settings.company.periodStart')}</th>
                    <th>{t('settings.company.periodEnd')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {accounting.periods.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.start_date.slice(0, 10)}</td>
                      <td>{p.end_date.slice(0, 10)}</td>
                      <td>
                        <Badge kind={p.status === 'open' ? 'success' : 'neutral'}>{p.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {tab === 'billing' && billing && (
        <Card title={t('settings.company.billing')}>
          <div className="grid-2">
            <Field label={t('settings.company.quotePrefix')}>
              <input
                value={billing.quotePrefix}
                onChange={(e) => setBilling({ ...billing, quotePrefix: e.target.value })}
                disabled={!can?.canEditBilling}
                maxLength={10}
              />
            </Field>
            <Field label={t('settings.company.invoicePrefix')}>
              <input
                value={billing.invoicePrefix}
                onChange={(e) => setBilling({ ...billing, invoicePrefix: e.target.value })}
                disabled={!can?.canEditBilling}
                maxLength={10}
              />
            </Field>
            <Field label={t('settings.company.creditPrefix')}>
              <input
                value={billing.creditPrefix}
                onChange={(e) => setBilling({ ...billing, creditPrefix: e.target.value })}
                disabled={!can?.canEditBilling}
                maxLength={10}
              />
            </Field>
            <Field label={t('settings.company.numbering')}>
              <select
                value={billing.numberingPolicy}
                onChange={(e) =>
                  setBilling({ ...billing, numberingPolicy: e.target.value as 'yearly' | 'continuous' })
                }
                disabled={!can?.canEditBilling}
              >
                <option value="yearly">{t('settings.company.numberingYearly')}</option>
                <option value="continuous">{t('settings.company.numberingContinuous')}</option>
              </select>
            </Field>
            <Field label={t('settings.company.paymentTerms')}>
              <input
                type="number"
                min={0}
                max={365}
                value={billing.defaultPaymentTerms}
                onChange={(e) => setBilling({ ...billing, defaultPaymentTerms: Number(e.target.value) })}
                disabled={!can?.canEditBilling}
              />
            </Field>
            <Field label={t('settings.company.documentLanguage')}>
              <select
                value={billing.documentLanguage}
                onChange={(e) =>
                  setBilling({ ...billing, documentLanguage: e.target.value as 'fr' | 'en' })
                }
                disabled={!can?.canEditBilling}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>

          <Field label={t('settings.company.logoUrl')}>
            <input
              value={billing.logoUrl ?? ''}
              onChange={(e) => setBilling({ ...billing, logoUrl: e.target.value })}
              disabled={!can?.canEditBilling}
              placeholder="https://…"
            />
          </Field>
          <div className="grid-2">
            <Field label={t('settings.company.footerFr')}>
              <textarea
                rows={2}
                value={billing.legalFooterFr ?? ''}
                onChange={(e) => setBilling({ ...billing, legalFooterFr: e.target.value })}
                disabled={!can?.canEditBilling}
              />
            </Field>
            <Field label={t('settings.company.footerEn')}>
              <textarea
                rows={2}
                value={billing.legalFooterEn ?? ''}
                onChange={(e) => setBilling({ ...billing, legalFooterEn: e.target.value })}
                disabled={!can?.canEditBilling}
              />
            </Field>
          </div>
          <Field label={t('settings.company.bankDetails')}>
            <textarea
              rows={2}
              value={billing.bankDetails ?? ''}
              onChange={(e) => setBilling({ ...billing, bankDetails: e.target.value })}
              disabled={!can?.canEditBilling}
            />
          </Field>

          <h3>{t('settings.company.defaultAccounts')}</h3>
          <p className="muted small">{t('settings.company.defaultAccountsHint')}</p>
          <div className="grid-2">
            {(
              [
                ['defaultRevenueAccountId', 'defaultRevenue'],
                ['defaultReceivableAccountId', 'defaultReceivable'],
                ['defaultBankAccountId', 'defaultBank'],
                ['defaultPurchaseAccountId', 'defaultPurchase'],
                ['defaultVatInputAccountId', 'defaultVatInput'],
                ['defaultVatOutputAccountId', 'defaultVatOutput'],
              ] as [keyof NonNullable<SettingsView['billing']>, string][]
            ).map(([key, labelKey]) => (
              <Field key={String(key)} label={t(`settings.company.${labelKey}`)}>
                <select
                  value={(billing[key] as string | null) ?? ''}
                  onChange={(e) =>
                    setBilling({ ...billing, [key]: e.target.value || null } as NonNullable<SettingsView['billing']>)
                  }
                  disabled={!can?.canEditBilling}
                >
                  <option value="">{t('common.none')}</option>
                  {accounts
                    .filter((a) => a.is_active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                </select>
              </Field>
            ))}
          </div>

          <Button
            disabled={!can?.canEditBilling || busy}
            onClick={() =>
              void save(
                'settings/billing',
                {
                  quotePrefix: billing.quotePrefix,
                  invoicePrefix: billing.invoicePrefix,
                  creditPrefix: billing.creditPrefix,
                  numberingPolicy: billing.numberingPolicy,
                  defaultPaymentTerms: billing.defaultPaymentTerms,
                  documentLanguage: billing.documentLanguage,
                  logoUrl: billing.logoUrl,
                  legalFooterFr: billing.legalFooterFr,
                  legalFooterEn: billing.legalFooterEn,
                  bankDetails: billing.bankDetails,
                  defaultRevenueAccountId: billing.defaultRevenueAccountId,
                  defaultReceivableAccountId: billing.defaultReceivableAccountId,
                  defaultBankAccountId: billing.defaultBankAccountId,
                  defaultPurchaseAccountId: billing.defaultPurchaseAccountId,
                  defaultVatInputAccountId: billing.defaultVatInputAccountId,
                  defaultVatOutputAccountId: billing.defaultVatOutputAccountId,
                },
                'settings.company.saved',
              )
            }
          >
            {t('common.save')}
          </Button>
        </Card>
      )}

      {tab === 'tax' && (
        <>
          <Card title={t('settings.company.tax')}>
            <div className="alert alert-info">{view.tax.notice}</div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={commercial.vatEnabled}
                onChange={(e) => setCommercial({ ...commercial, vatEnabled: e.target.checked })}
                disabled={!can?.canEditBilling}
              />
              <span>{t('settings.company.vatEnabled')}</span>
            </label>
            <Field label={t('settings.company.vatNumber')}>
              <input
                value={commercial.vatNumber}
                onChange={(e) => setCommercial({ ...commercial, vatNumber: e.target.value })}
                disabled={!can?.canEditBilling}
              />
            </Field>
            <Button
              disabled={!can?.canEditBilling || busy}
              onClick={() =>
                void save(
                  'settings/billing',
                  { vatEnabled: commercial.vatEnabled, vatNumber: commercial.vatNumber },
                  'settings.company.saved',
                )
              }
            >
              {t('common.save')}
            </Button>
            <p className="muted small">
              {t('settings.company.verifiedCount')}: {view.tax.verifiedCount} ·{' '}
              {t('settings.company.unverifiedCount')}: {view.tax.unverifiedCount}
            </p>
          </Card>

          <Card title={t('settings.company.vatRates')}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('settings.company.code')}</th>
                  <th>{t('settings.company.label')}</th>
                  <th>{t('settings.company.rate')}</th>
                  <th>{t('settings.company.treatment')}</th>
                  <th>{t('settings.company.period')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view.tax.rates.map((rate) => (
                  <tr key={rate.id}>
                    <td>{rate.code}</td>
                    <td>{rate.label}</td>
                    <td>{rate.rate}</td>
                    <td>{TREATMENTS.find((x) => x.key === rate.treatment)?.[locale] ?? rate.treatment}</td>
                    <td>
                      {rate.effectiveFrom.slice(0, 10)}
                      {rate.effectiveTo ? ` → ${rate.effectiveTo.slice(0, 10)}` : ''}
                    </td>
                    <td>
                      {rate.verified ? (
                        <Badge kind="success">{t('settings.company.verified')}</Badge>
                      ) : (
                        <Badge kind="warning">{t('settings.company.unverified')}</Badge>
                      )}
                    </td>
                    <td className="row-actions">
                      {can?.canEditTax && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setVerifyFor(rate.id);
                              setVerifyForm({ source: rate.source ?? '', confirm: false });
                            }}
                          >
                            {t('settings.company.verify')}
                          </button>
                          {rate.verified && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await api.post(
                                    `/companies/${companyId}/billing/tax-rates/${rate.id}/unverify`,
                                    {},
                                  );
                                  await load();
                                  setNotice(t('settings.company.unverifiedNow'));
                                } catch (err) {
                                  setError(errorMessage(err, t('common.error')).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              {t('settings.company.unverify')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={async () => {
                              if (historyFor === rate.id) {
                                setHistoryFor(null);
                                return;
                              }
                              setHistoryFor(rate.id);
                              if (!history[rate.id]) {
                                try {
                                  const res = await api.get<{
                                    events: { id: string; action: string; createdAt: string }[];
                                  }>(`/companies/${companyId}/billing/tax-rates/${rate.id}/history`);
                                  setHistory((current) => ({ ...current, [rate.id]: res.events }));
                                } catch (err) {
                                  setError(errorMessage(err, t('common.error')).message);
                                }
                              }
                            }}
                          >
                            {t('settings.company.history')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {view.tax.rates.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {t('settings.company.noRate')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {historyFor && (
              <div className="rate-history">
                <h4>{t('settings.company.history')}</h4>
                <ul>
                  {(history[historyFor] ?? []).map((event) => (
                    <li key={event.id}>
                      {new Date(event.createdAt).toLocaleString()} — {event.action}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {verifyFor && (
              <div className="verify-box">
                <h4>{t('settings.company.verifyTitle')}</h4>
                <p className="muted small">{t('settings.company.verifyHint')}</p>
                <Field label={t('settings.company.source')}>
                  <input
                    value={verifyForm.source}
                    onChange={(e) => setVerifyForm({ ...verifyForm, source: e.target.value })}
                    placeholder={t('settings.company.sourcePlaceholder')}
                  />
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={verifyForm.confirm}
                    onChange={(e) => setVerifyForm({ ...verifyForm, confirm: e.target.checked })}
                  />
                  <span>{t('settings.company.verifyConfirm')}</span>
                </label>
                <div className="row-actions">
                  <Button
                    disabled={busy || verifyForm.source.trim().length < 5 || !verifyForm.confirm}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await api.post(
                          `/companies/${companyId}/billing/tax-rates/${verifyFor}/verify`,
                          { source: verifyForm.source, confirm: true },
                        );
                        setVerifyFor(null);
                        setHistory({});
                        await load();
                        setNotice(t('settings.company.verifiedNow'));
                      } catch (err) {
                        setError(errorMessage(err, t('common.error')).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t('settings.company.verify')}
                  </Button>
                  <button type="button" className="btn btn-ghost" onClick={() => setVerifyFor(null)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card title={t('settings.company.addRate')}>
            <div className="grid-2">
              <Field label={t('settings.company.code')}>
                <input
                  value={rateForm.code}
                  onChange={(e) => setRateForm({ ...rateForm, code: e.target.value })}
                  maxLength={30}
                />
              </Field>
              <Field label={t('settings.company.label')}>
                <input
                  value={rateForm.label}
                  onChange={(e) => setRateForm({ ...rateForm, label: e.target.value })}
                  maxLength={120}
                />
              </Field>
              <Field label={t('settings.company.rate')}>
                <input
                  value={rateForm.rate}
                  onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })}
                  inputMode="decimal"
                />
              </Field>
              <Field label={t('settings.company.treatment')}>
                <select
                  value={rateForm.treatment}
                  onChange={(e) => setRateForm({ ...rateForm, treatment: e.target.value as Treatment })}
                >
                  {TREATMENTS.map((treatment) => (
                    <option key={treatment.key} value={treatment.key}>
                      {treatment[locale]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('settings.company.periodStart')}>
                <input
                  type="date"
                  value={rateForm.effectiveFrom}
                  onChange={(e) => setRateForm({ ...rateForm, effectiveFrom: e.target.value })}
                />
              </Field>
              <Field label={t('settings.company.periodEnd')}>
                <input
                  type="date"
                  value={rateForm.effectiveTo}
                  onChange={(e) => setRateForm({ ...rateForm, effectiveTo: e.target.value })}
                />
              </Field>
              <Field label={t('settings.company.vatAccount')}>
                <select
                  value={rateForm.vatAccountId}
                  onChange={(e) => setRateForm({ ...rateForm, vatAccountId: e.target.value })}
                >
                  <option value="">{t('common.none')}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t('settings.company.source')}>
              <input
                value={rateForm.source}
                onChange={(e) => setRateForm({ ...rateForm, source: e.target.value })}
                placeholder={t('settings.company.sourcePlaceholder')}
              />
            </Field>
            <p className="muted small">{t('settings.company.addRateHint')}</p>
            <Button
              disabled={!can?.canEditTax || busy || rateForm.code.trim() === '' || rateForm.label.trim() === ''}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.post(`/companies/${companyId}/billing/tax-rates`, {
                    code: rateForm.code.trim(),
                    label: rateForm.label.trim(),
                    rate: rateForm.treatment === 'taxable' ? rateForm.rate : '0',
                    treatment: rateForm.treatment,
                    effectiveFrom: rateForm.effectiveFrom,
                    effectiveTo: rateForm.effectiveTo || null,
                    source: rateForm.source || null,
                    vatAccountId: rateForm.vatAccountId || null,
                    verified: false,
                  });
                  setRateForm({ ...emptyForm });
                  await load();
                  setNotice(t('settings.company.rateAdded'));
                } catch (err) {
                  setError(errorMessage(err, t('common.error')).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('settings.company.addRate')}
            </Button>
          </Card>
        </>
      )}

      <Card title={t('settings.company.history')}>
        {view.history.length === 0 ? (
          <p className="muted">{t('settings.company.noHistory')}</p>
        ) : (
          <ul className="history-list">
            {view.history.map((entry) => (
              <li key={entry.id}>
                <span className="muted">{new Date(entry.createdAt).toLocaleString()}</span> — {entry.action}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
