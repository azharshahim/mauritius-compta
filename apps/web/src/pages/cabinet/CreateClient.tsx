import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import { translateError } from '../../i18n';
import { Badge, Card, ErrorBanner, Field, Spinner } from '../../components/ui';
import { AppIcon } from '../../components/AppIcon';
import { ProgressBar, StepList, ONBOARDING_STEP_KEYS } from '../../components/cabinet/StepList';
import {
  KYC_STATUS_OPTIONS,
  availabilityBadge,
  kycCategoryLabelKey,
  statusKind,
  statusLabelKey,
} from '../../cabinet/workspace';
import { computeOnboardingProgress } from '../../../../api/src/modules/cabinet-onboarding/progress';
import {
  KYC_TEMPLATE,
  MODULE_CATALOGUE,
  SECTORS,
  SUPPORTED_CURRENCIES,
} from '../../../../api/src/modules/cabinet-onboarding/catalogue';

interface KycRow {
  key: string;
  status: string;
  documentRef: string;
  note: string;
}

interface DraftPayload {
  company: Record<string, string>;
  financial: Record<string, string>;
  kyc: { checks: KycRow[] };
  sector: string | null;
  sectorNotes: string;
  accountingSetup: Record<string, string | boolean>;
  modules: string[];
}

const LEGAL_FORM_KEYS = [
  'private_company',
  'public_company',
  'sole_trader',
  'partnership',
  'societe',
  'trust',
  'foundation',
  'branch_foreign',
  'other',
];

const CHART_KEYS = ['provisional_template', 'import_later'];
const OPENING_KEYS = ['existing_screen', 'later', 'not_applicable'];
const TAX_KEYS = ['registered', 'not_registered', 'to_confirm'];

function currentFiscalYear(): { start: string; end: string } {
  // Presentation default only (1 July – 30 June). It is editable and is not
  // presented as a legal obligation: see docs/cabinet-onboarding.md.
  const today = new Date();
  const year = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return { start: `${year}-07-01`, end: `${year + 1}-06-30` };
}

function initialPayload(): DraftPayload {
  const fy = currentFiscalYear();
  return {
    company: {
      name: '',
      tradeName: '',
      brn: '',
      crn: '',
      legalForm: 'private_company',
      incorporationDate: '',
      address: '',
      country: 'Mauritius',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      businessDescription: '',
      clientCode: '',
    },
    financial: {
      financialYearStart: fy.start,
      financialYearEnd: fy.end,
      functionalCurrency: 'MUR',
      presentationCurrency: 'MUR',
      accountingStandard: 'IFRS',
      vatNumber: '',
    },
    kyc: {
      checks: KYC_TEMPLATE.map((item) => ({
        key: item.key,
        status: 'not_started',
        documentRef: '',
        note: '',
      })),
    },
    sector: null,
    sectorNotes: '',
    accountingSetup: {
      accountingBasis: 'accrual',
      chartChoice: 'provisional_template',
      openingBalanceChoice: 'later',
      taxRegistration: 'to_confirm',
      bankAccountsReviewed: false,
      vatRegistered: false,
      notes: '',
    },
    modules: MODULE_CATALOGUE.filter((m) => m.defaultSelected).map((m) => m.code),
  };
}

function mergePayload(raw: any): DraftPayload {
  const base = initialPayload();
  if (!raw || typeof raw !== 'object') return base;
  const checks = new Map<string, any>(
    (raw.kyc?.checks ?? []).map((check: any) => [check.key, check]),
  );
  return {
    company: { ...base.company, ...(raw.company ?? {}) },
    financial: { ...base.financial, ...(raw.financial ?? {}) },
    kyc: {
      checks: base.kyc.checks.map((row) => {
        const stored = checks.get(row.key);
        return stored
          ? {
              key: row.key,
              status: String(stored.status ?? 'not_started'),
              documentRef: stored.documentRef ?? '',
              note: stored.note ?? '',
            }
          : row;
      }),
    },
    sector: typeof raw.sector === 'string' ? raw.sector : null,
    sectorNotes: raw.sectorNotes ?? '',
    accountingSetup: { ...base.accountingSetup, ...(raw.accountingSetup ?? {}) },
    modules: Array.isArray(raw.modules)
      ? raw.modules.filter((code: string) => MODULE_CATALOGUE.some((m) => m.code === code))
      : base.modules,
  };
}

/**
 * Mission 44 — Create New Client.
 *
 * A real, navigable six-step assistant. Every step is saved as a draft the
 * accountant can resume later; activation creates one client file through the
 * existing company provisioning path. KYC stays a checklist: the last step
 * states that no document is uploaded and no legal validation is performed.
 */
export default function CreateClientPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resumeId = params.get('draft');

  const [stepKey, setStepKey] = useState<string>('company_information');
  const [payload, setPayload] = useState<DraftPayload>(initialPayload);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(resumeId));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ drafts: any[] }>('/cabinet/workspace/drafts');
        const draft = res.drafts.find((d) => d.id === resumeId);
        if (cancelled) return;
        if (!draft) {
          setError(t('m44.create.draftMissing'));
          return;
        }
        setDraftId(draft.id);
        setPayload(mergePayload(draft.payload));
        const index = Math.min(Math.max(Number(draft.current_step ?? 1) - 1, 0), 5);
        setStepKey(ONBOARDING_STEP_KEYS[index]!);
      } catch (err) {
        if (!cancelled) setError(translateError((err as ApiError).code, (err as Error).message, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  const stepIndex = ONBOARDING_STEP_KEYS.indexOf(stepKey as (typeof ONBOARDING_STEP_KEYS)[number]);

  const sectorDefinition = SECTORS.find((s) => s.key === payload.sector) ?? null;

  const preview = useMemo(() => {
    const checks = payload.kyc.checks.map((row) => ({
      key: row.key,
      status: row.status as any,
      required: KYC_TEMPLATE.find((item) => item.key === row.key)?.required ?? true,
    }));
    return computeOnboardingProgress({
      company: {
        name: payload.company.name,
        registered_address: payload.company.address,
        financial_year_start: payload.financial.financialYearStart,
        financial_year_end: payload.financial.financialYearEnd,
        functional_currency: payload.financial.functionalCurrency,
      },
      onboarding: {
        sector: payload.sector,
        selected_modules: payload.modules,
        accounting_setup: payload.accountingSetup,
        kyc_review_status: 'in_progress',
        status: 'in_progress',
        activated_at: null,
      },
      kycChecks: checks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const setCompany = (key: string, value: string) => {
    setPayload((current) => ({ ...current, company: { ...current.company, [key]: value } }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  };
  const setFinancial = (key: string, value: string) =>
    setPayload((current) => ({ ...current, financial: { ...current.financial, [key]: value } }));
  const setSetup = (key: string, value: string | boolean) =>
    setPayload((current) => ({
      ...current,
      accountingSetup: { ...current.accountingSetup, [key]: value },
    }));
  const setCheck = (key: string, patch: Partial<KycRow>) =>
    setPayload((current) => ({
      ...current,
      kyc: {
        checks: current.kyc.checks.map((row) => (row.key === key ? { ...row, ...patch } : row)),
      },
    }));
  const toggleModule = (code: string) =>
    setPayload((current) => ({
      ...current,
      modules: current.modules.includes(code)
        ? current.modules.filter((c) => c !== code)
        : [...current.modules, code],
    }));

  const validateStep = (key: string): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (key === 'company_information') {
      if (!payload.company.name?.trim()) errors.name = t('m44.create.required');
      if (!payload.company.address?.trim()) errors.address = t('m44.create.required');
      if (
        payload.company.contactEmail &&
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.company.contactEmail)
      ) {
        errors.contactEmail = t('m44.create.invalidEmail');
      }
    }
    if (key === 'accounting_setup') {
      if (
        !payload.financial.financialYearStart ||
        !payload.financial.financialYearEnd ||
        payload.financial.financialYearEnd <= payload.financial.financialYearStart
      ) {
        errors.financialYearEnd = t('m44.create.invalidYear');
      }
      if (!payload.accountingSetup.chartChoice) errors.chartChoice = t('m44.create.required');
      if (!payload.accountingSetup.openingBalanceChoice) errors.openingBalanceChoice = t('m44.create.required');
      if (!payload.accountingSetup.taxRegistration) errors.taxRegistration = t('m44.create.required');
    }
    if (key === 'sector' && !payload.sector) errors.sector = t('m44.create.requiredSector');
    if (key === 'modules') {
      if (payload.modules.length === 0) errors.modules = t('m44.create.requiredModule');
      else if (
        payload.modules.every(
          (code) => MODULE_CATALOGUE.find((m) => m.code === code)?.availability === 'prepared',
        )
      ) {
        errors.modules = t('m44.create.preparedOnly');
      }
    }
    return errors;
  };

  const saveDraft = async (nextStepKey?: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        currentStep: ONBOARDING_STEP_KEYS.indexOf(
          (nextStepKey ?? stepKey) as (typeof ONBOARDING_STEP_KEYS)[number],
        ) + 1,
        payload,
      };
      if (draftId) {
        await api.patch(`/cabinet/workspace/drafts/${draftId}`, body);
      } else {
        const created = await api.post<{ draft: { id: string } }>('/cabinet/workspace/drafts', body);
        setDraftId(created.draft.id);
      }
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(translateError((err as ApiError).code, (err as Error).message, t));
    } finally {
      setSaving(false);
    }
  };

  const goTo = (key: string) => {
    setStepKey(key);
    setFieldErrors({});
    if (key !== 'activation') void saveDraft(key);
  };

  const next = async () => {
    const errors = validateStep(stepKey);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    const target = ONBOARDING_STEP_KEYS[Math.min(stepIndex + 1, ONBOARDING_STEP_KEYS.length - 1)]!;
    setFieldErrors({});
    setStepKey(target);
    await saveDraft(target);
  };

  const previous = () => {
    const target = ONBOARDING_STEP_KEYS[Math.max(stepIndex - 1, 0)]!;
    setStepKey(target);
    setFieldErrors({});
  };

  const activate = async () => {
    setError(null);
    const checks: Record<string, string> = {};
    for (const key of ONBOARDING_STEP_KEYS) {
      Object.assign(checks, validateStep(key));
    }
    if (Object.keys(checks).length > 0) {
      setFieldErrors(checks);
      setError(t('m44.create.fixBeforeActivation'));
      return;
    }
    setActivating(true);
    try {
      let id = draftId;
      if (!id) {
        const created = await api.post<{ draft: { id: string } }>('/cabinet/workspace/drafts', {
          currentStep: 6,
          payload,
        });
        id = created.draft.id;
        setDraftId(id);
      } else {
        await api.patch(`/cabinet/workspace/drafts/${id}`, { currentStep: 6, payload });
      }
      const result = await api.post<{ company: { id: string } }>(
        `/cabinet/workspace/drafts/${id}/activate`,
      );
      navigate(`/cabinet/clients/${result.company.id}/workspace?created=1`);
    } catch (err) {
      setError(translateError((err as ApiError).code, (err as Error).message, t));
    } finally {
      setActivating(false);
    }
  };

  if (loading) return <Spinner label={t('common.loading')} />;

  const categories = [...new Set(KYC_TEMPLATE.map((item) => item.category))];
  const stepStatuses = ONBOARDING_STEP_KEYS.map((key) => {
    const index = ONBOARDING_STEP_KEYS.indexOf(key);
    if (index < stepIndex) return { key, status: 'completed' };
    if (index === stepIndex) return { key, status: 'in_progress' };
    return { key, status: 'not_started' };
  });

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="m44-kicker">{t('m44.workspace.kicker')}</div>
          <h1>{t('m44.create.title')}</h1>
          <div className="page-sub">{t('m44.create.sub')}</div>
        </div>
        <div className="m44-head-actions">
          <button className="btn" type="button" onClick={() => void saveDraft()} disabled={saving}>
            <AppIcon name="save" size={16} /> {saving ? t('common.saving') : t('m44.create.saveDraft')}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => navigate('/cabinet')}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="m44-wizard">
        <aside className="m44-wizard-rail">
          <StepList steps={stepStatuses} current={stepKey} onSelect={goTo} />
          <div className="m44-rail-progress">
            <div className="page-sub">{t('m44.create.progressPreview')}</div>
            <ProgressBar percent={preview.percent} />
            <div className="page-sub">
              {t('m44.create.progressDetail', {
                done: preview.completedSteps,
                total: preview.totalSteps,
              })}
            </div>
            {preview.blockedSteps.length > 0 && (
              <p className="m44-danger-text">{t('m44.create.blockedPreview')}</p>
            )}
          </div>
          {savedAt && (
            <p className="page-sub m44-saved">
              <AppIcon name="check" size={14} /> {t('m44.create.saved')}
            </p>
          )}
        </aside>

        <div className="m44-wizard-body">
          {stepKey === 'company_information' && (
            <Card title={t('m44.step.company_information')}>
              <p className="page-sub">{t('m44.create.company.hint')}</p>
              <div className="form-grid">
                <Field label={t('m44.field.registeredName')} error={fieldErrors.name}>
                  <input
                    value={payload.company.name ?? ''}
                    onChange={(e) => setCompany('name', e.target.value)}
                    autoComplete="organization"
                    required
                  />
                </Field>
                <Field label={t('m44.field.tradingName')} hint={t('m44.field.optional')}>
                  <input
                    value={payload.company.tradeName ?? ''}
                    onChange={(e) => setCompany('tradeName', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.brn')} hint={t('m44.field.brn.hint')}>
                  <input
                    value={payload.company.brn ?? ''}
                    onChange={(e) => setCompany('brn', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.crn')} hint={t('m44.field.optional')}>
                  <input
                    value={payload.company.crn ?? ''}
                    onChange={(e) => setCompany('crn', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.legalForm')}>
                  <select
                    value={payload.company.legalForm ?? ''}
                    onChange={(e) => setCompany('legalForm', e.target.value)}
                  >
                    {LEGAL_FORM_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {t(`m44.legalForm.${key}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t('m44.field.incorporationDate')}
                  hint={t('m44.field.optional')}
                >
                  <input
                    type="date"
                    value={payload.company.incorporationDate ?? ''}
                    onChange={(e) => setCompany('incorporationDate', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.clientCode')} hint={t('m44.field.optional')}>
                  <input
                    value={payload.company.clientCode ?? ''}
                    onChange={(e) => setCompany('clientCode', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.country')}>
                  <input
                    value={payload.company.country ?? ''}
                    onChange={(e) => setCompany('country', e.target.value)}
                  />
                </Field>
                <Field
                  label={t('m44.field.address')}
                  error={fieldErrors.address}
                  className="m44-span-2"
                >
                  <textarea
                    rows={2}
                    value={payload.company.address ?? ''}
                    onChange={(e) => setCompany('address', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.primaryContact')} hint={t('m44.field.optional')}>
                  <input
                    value={payload.company.contactName ?? ''}
                    onChange={(e) => setCompany('contactName', e.target.value)}
                  />
                </Field>
                <Field
                  label={t('m44.field.contactEmail')}
                  error={fieldErrors.contactEmail}
                  hint={t('m44.field.optional')}
                >
                  <input
                    type="email"
                    inputMode="email"
                    value={payload.company.contactEmail ?? ''}
                    onChange={(e) => setCompany('contactEmail', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.contactPhone')} hint={t('m44.field.optional')}>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={payload.company.contactPhone ?? ''}
                    onChange={(e) => setCompany('contactPhone', e.target.value)}
                  />
                </Field>
                <Field
                  label={t('m44.field.description')}
                  hint={t('m44.field.optional')}
                  className="m44-span-2"
                >
                  <textarea
                    rows={2}
                    value={payload.company.businessDescription ?? ''}
                    onChange={(e) => setCompany('businessDescription', e.target.value)}
                  />
                </Field>
              </div>
            </Card>
          )}

          {stepKey === 'kyc' && (
            <Card title={t('m44.step.kyc')}>
              <div className="alert alert-info m44-kyc-note" role="note">
                {t('m44.kyc.disclaimer')}
              </div>
              <p className="page-sub">{t('m44.kyc.intro')}</p>
              {categories.map((category) => (
                <section key={category} className="m44-kyc-group">
                  <h3>{t(kycCategoryLabelKey(category))}</h3>
                  <ul className="m44-kyc-list">
                    {KYC_TEMPLATE.filter((item) => item.category === category).map((item) => {
                      const row = payload.kyc.checks.find((c) => c.key === item.key)!;
                      return (
                        <li key={item.key}>
                          <div className="m44-kyc-label">
                            <strong>{t(item.labelKey)}</strong>
                            {!item.required && <Badge kind="neutral">{t('m44.kyc.optional')}</Badge>}
                            <div className="page-sub">{t(item.hintKey)}</div>
                          </div>
                          <div className="m44-kyc-controls">
                            <label className="field">
                              <span className="field-label">{t('m44.kyc.status')}</span>
                              <select
                                value={row.status}
                                onChange={(e) => setCheck(item.key, { status: e.target.value })}
                                aria-label={`${t(item.labelKey)} — ${t('m44.kyc.status')}`}
                              >
                                {KYC_STATUS_OPTIONS.map((status) => (
                                  <option key={status} value={status}>
                                    {t(statusLabelKey(status))}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">{t('m44.kyc.reference')}</span>
                              <input
                                value={row.documentRef}
                                onChange={(e) => setCheck(item.key, { documentRef: e.target.value })}
                                placeholder={t('m44.kyc.reference.placeholder')}
                              />
                            </label>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </Card>
          )}

          {stepKey === 'sector' && (
            <Card title={t('m44.step.sector')}>
              <p className="page-sub">{t('m44.sector.intro')}</p>
              {fieldErrors.sector && <div className="alert alert-error">{fieldErrors.sector}</div>}
              <div className="m44-sector-grid">
                {SECTORS.map((sector) => (
                  <button
                    key={sector.key}
                    type="button"
                    className={`m44-sector-card ${payload.sector === sector.key ? 'selected' : ''}`}
                    aria-pressed={payload.sector === sector.key}
                    onClick={() =>
                      setPayload((current) => ({
                        ...current,
                        sector: sector.key,
                        modules:
                          current.sector === sector.key ? current.modules : sector.suggestedModules,
                      }))
                    }
                  >
                    <strong>{t(sector.labelKey)}</strong>
                    <span className="page-sub">{t(sector.descriptionKey)}</span>
                  </button>
                ))}
              </div>
              <p className="page-sub">{t('m44.sector.suggestNote')}</p>
              {sectorDefinition && (
                <div className="m44-attention">
                  <h3>{t('m44.sector.attention')}</h3>
                  <ul>
                    {sectorDefinition.attentionKeys.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Field label={t('m44.sector.notes')} hint={t('m44.field.optional')}>
                <textarea
                  rows={3}
                  value={payload.sectorNotes}
                  onChange={(e) => setPayload((c) => ({ ...c, sectorNotes: e.target.value }))}
                />
              </Field>
            </Card>
          )}

          {stepKey === 'accounting_setup' && (
            <Card title={t('m44.step.accounting_setup')}>
              <p className="page-sub">{t('m44.setup.intro')}</p>
              <div className="form-grid">
                <Field label={t('m44.field.financialYearStart')}>
                  <input
                    type="date"
                    value={payload.financial.financialYearStart ?? ''}
                    onChange={(e) => setFinancial('financialYearStart', e.target.value)}
                  />
                </Field>
                <Field
                  label={t('m44.field.financialYearEnd')}
                  error={fieldErrors.financialYearEnd}
                >
                  <input
                    type="date"
                    value={payload.financial.financialYearEnd ?? ''}
                    onChange={(e) => setFinancial('financialYearEnd', e.target.value)}
                  />
                </Field>
                <Field label={t('m44.field.functionalCurrency')}>
                  <select
                    value={payload.financial.functionalCurrency ?? 'MUR'}
                    onChange={(e) => {
                      setFinancial('functionalCurrency', e.target.value);
                      setFinancial('presentationCurrency', e.target.value);
                    }}
                  >
                    {SUPPORTED_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('m44.field.presentationCurrency')}>
                  <select
                    value={payload.financial.presentationCurrency ?? 'MUR'}
                    onChange={(e) => setFinancial('presentationCurrency', e.target.value)}
                  >
                    {SUPPORTED_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('m44.field.accountingStandard')}>
                  <select
                    value={payload.financial.accountingStandard ?? 'IFRS'}
                    onChange={(e) => setFinancial('accountingStandard', e.target.value)}
                  >
                    <option value="IFRS">IFRS</option>
                    <option value="Other">{t('m44.setup.standardOther')}</option>
                  </select>
                </Field>
                <Field
                  label={t('m44.field.accountingBasis')}
                  hint={t('m44.setup.basisHint')}
                >
                  <select value="accrual" disabled aria-disabled="true">
                    <option value="accrual">{t('m44.setup.basisAccrual')}</option>
                  </select>
                </Field>
                <Field
                  label={t('m44.field.chartChoice')}
                  error={fieldErrors.chartChoice}
                  hint={t('m44.setup.chartHint')}
                >
                  <select
                    value={String(payload.accountingSetup.chartChoice ?? '')}
                    onChange={(e) => setSetup('chartChoice', e.target.value)}
                  >
                    <option value="">{t('common.none')}</option>
                    {CHART_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {t(`m44.setup.chart.${key}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t('m44.field.openingBalanceChoice')}
                  error={fieldErrors.openingBalanceChoice}
                >
                  <select
                    value={String(payload.accountingSetup.openingBalanceChoice ?? '')}
                    onChange={(e) => setSetup('openingBalanceChoice', e.target.value)}
                  >
                    <option value="">{t('common.none')}</option>
                    {OPENING_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {t(`m44.setup.opening.${key}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t('m44.field.taxRegistration')}
                  error={fieldErrors.taxRegistration}
                  hint={t('m44.setup.taxHint')}
                >
                  <select
                    value={String(payload.accountingSetup.taxRegistration ?? '')}
                    onChange={(e) => setSetup('taxRegistration', e.target.value)}
                  >
                    <option value="">{t('common.none')}</option>
                    {TAX_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {t(`m44.setup.tax.${key}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('m44.field.vatNumber')} hint={t('m44.field.optional')}>
                  <input
                    value={payload.financial.vatNumber ?? ''}
                    onChange={(e) => setFinancial('vatNumber', e.target.value)}
                  />
                </Field>
              </div>
              <label className="m44-check">
                <input
                  type="checkbox"
                  checked={Boolean(payload.accountingSetup.bankAccountsReviewed)}
                  onChange={(e) => setSetup('bankAccountsReviewed', e.target.checked)}
                />
                <span>{t('m44.setup.bankReviewed')}</span>
              </label>
              <label className="m44-check">
                <input
                  type="checkbox"
                  checked={Boolean(payload.accountingSetup.vatRegistered)}
                  onChange={(e) => setSetup('vatRegistered', e.target.checked)}
                />
                <span>{t('m44.setup.vatRegistered')}</span>
              </label>
              <Field label={t('m44.setup.notes')} hint={t('m44.field.optional')}>
                <textarea
                  rows={2}
                  value={String(payload.accountingSetup.notes ?? '')}
                  onChange={(e) => setSetup('notes', e.target.value)}
                />
              </Field>
              <div className="m44-attention">
                <h3>{t('m44.setup.reuseTitle')}</h3>
                <p className="page-sub">{t('m44.setup.reuse')}</p>
                <p className="page-sub">{t('m44.setup.basisUnavailable')}</p>
              </div>
            </Card>
          )}

          {stepKey === 'modules' && (
            <Card title={t('m44.step.modules')}>
              <p className="page-sub">{t('m44.modules.intro')}</p>
              {fieldErrors.modules && <div className="alert alert-error">{fieldErrors.modules}</div>}
              <ul className="m44-module-grid">
                {MODULE_CATALOGUE.map((module) => {
                  const badge = availabilityBadge(module.availability);
                  const selected = payload.modules.includes(module.code);
                  return (
                    <li
                      key={module.code}
                      className={`m44-module-card ${selected ? 'selected' : ''}`}
                    >
                      <label className="m44-module-head">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleModule(module.code)}
                        />
                        <span>
                          <strong>
                            {module.order}. {t(module.labelKey)}
                          </strong>
                          <Badge kind={badge.kind}>{t(badge.labelKey)}</Badge>
                        </span>
                      </label>
                      <p className="page-sub">{t(module.descriptionKey)}</p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {stepKey === 'activation' && (
            <Card title={t('m44.step.activation')}>
              <p className="page-sub">{t('m44.review.intro')}</p>
              <ProgressBar percent={preview.percent} />
              <p className="page-sub">
                {t('m44.create.progressDetail', {
                  done: preview.completedSteps,
                  total: preview.totalSteps,
                })}
              </p>

              <div className="m44-review">
                <section>
                  <h3>{t('m44.review.company')}</h3>
                  <dl>
                    <div>
                      <dt>{t('m44.field.registeredName')}</dt>
                      <dd>{payload.company.name || '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('m44.field.brn')}</dt>
                      <dd className="mono">{payload.company.brn || '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('m44.field.address')}</dt>
                      <dd>{payload.company.address || '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('m44.field.contactEmail')}</dt>
                      <dd>{payload.company.contactEmail || '—'}</dd>
                    </div>
                  </dl>
                  <button className="btn btn-sm btn-link" type="button" onClick={() => goTo('company_information')}>
                    {t('m44.review.edit')}
                  </button>
                </section>

                <section>
                  <h3>{t('m44.review.kyc')}</h3>
                  <p className="page-sub">
                    {t('m44.review.kycSummary', {
                      received: payload.kyc.checks.filter((c) =>
                        ['received', 'verified'].includes(c.status),
                      ).length,
                      total: payload.kyc.checks.length,
                    })}
                  </p>
                  {preview.missingDocuments.length > 0 && (
                    <p className="m44-warning-text">
                      {t('m44.review.missingDocs', { count: preview.missingDocuments.length })}
                    </p>
                  )}
                  <button className="btn btn-sm btn-link" type="button" onClick={() => goTo('kyc')}>
                    {t('m44.review.edit')}
                  </button>
                </section>

                <section>
                  <h3>{t('m44.review.sector')}</h3>
                  <p>{sectorDefinition ? t(sectorDefinition.labelKey) : '—'}</p>
                  <button className="btn btn-sm btn-link" type="button" onClick={() => goTo('sector')}>
                    {t('m44.review.edit')}
                  </button>
                </section>

                <section>
                  <h3>{t('m44.review.setup')}</h3>
                  <dl>
                    <div>
                      <dt>{t('m44.field.financialYearStart')}</dt>
                      <dd>
                        {payload.financial.financialYearStart} → {payload.financial.financialYearEnd}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('m44.field.functionalCurrency')}</dt>
                      <dd>{payload.financial.functionalCurrency}</dd>
                    </div>
                    <div>
                      <dt>{t('m44.field.chartChoice')}</dt>
                      <dd>
                        {payload.accountingSetup.chartChoice
                          ? t(`m44.setup.chart.${String(payload.accountingSetup.chartChoice)}`)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('m44.field.taxRegistration')}</dt>
                      <dd>
                        {payload.accountingSetup.taxRegistration
                          ? t(`m44.setup.tax.${String(payload.accountingSetup.taxRegistration)}`)
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                  <button className="btn btn-sm btn-link" type="button" onClick={() => goTo('accounting_setup')}>
                    {t('m44.review.edit')}
                  </button>
                </section>

                <section>
                  <h3>{t('m44.review.modules')}</h3>
                  <ul className="m44-chip-list">
                    {payload.modules.map((code) => {
                      const module = MODULE_CATALOGUE.find((m) => m.code === code)!;
                      return <li key={code}>{t(module.shortKey)}</li>;
                    })}
                  </ul>
                  <button className="btn btn-sm btn-link" type="button" onClick={() => goTo('modules')}>
                    {t('m44.review.edit')}
                  </button>
                </section>
              </div>

              <div className="alert alert-info" role="note">
                {t('m44.review.activationNote')}
              </div>
              {preview.blockedSteps.length > 0 && (
                <div className="alert alert-error" role="alert">
                  {t('m44.review.blocked')}
                </div>
              )}
              <div className="m44-wizard-actions">
                <button className="btn" type="button" onClick={previous}>
                  {t('m44.create.previous')}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void activate()}
                  disabled={activating}
                >
                  <AppIcon name="validate" size={16} />
                  {activating ? t('m44.create.activating') : t('m44.create.activate')}
                </button>
              </div>
              <p className="page-sub">{t('m44.review.legal')}</p>
            </Card>
          )}

          {stepKey !== 'activation' && (
            <div className="m44-wizard-actions">
              <button className="btn" type="button" onClick={previous} disabled={stepIndex === 0}>
                {t('m44.create.previous')}
              </button>
              <div className="m44-wizard-actions-right">
                <button className="btn" type="button" onClick={() => void saveDraft()} disabled={saving}>
                  {t('m44.create.saveDraft')}
                </button>
                <button className="btn btn-primary" type="button" onClick={() => void next()}>
                  {t('m44.create.next')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="page-sub m44-locale-hint">{locale === 'fr' ? t('m44.create.langHint') : ''}</p>
    </>
  );
}
