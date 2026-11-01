import { Link } from 'react-router-dom';
import { Badge, Button, Card, Field } from '../../components/ui';
import { useI18n } from '../../i18n';

/**
 * Mission 25 — MRA e-Invoicing, information screen only.
 *
 * This page deliberately imports neither `api` nor any network helper: opening
 * it can never contact the MRA, transmit an invoice or read an official
 * credential. The future settings area is rendered disabled, with no value
 * persisted, so the screen is not a second billing system.
 */

const PREPARATION_STEPS = [
  ['einv.step.registration', 'einv.step.registrationText'],
  ['einv.step.clients', 'einv.step.clientsText'],
  ['einv.step.legal', 'einv.step.legalText'],
  ['einv.step.technical', 'einv.step.technicalText'],
  ['einv.step.security', 'einv.step.securityText'],
  ['einv.step.production', 'einv.step.productionText'],
] as const;

const FEATURES = [
  ['✎', 'einv.feature.issue', 'einv.feature.issueText'],
  ['⇪', 'einv.feature.transmit', 'einv.feature.transmitText'],
  ['◷', 'einv.feature.status', 'einv.feature.statusText'],
  ['✓', 'einv.feature.ack', 'einv.feature.ackText'],
  ['⚠', 'einv.feature.errors', 'einv.feature.errorsText'],
  ['⇄', 'einv.feature.reconciliation', 'einv.feature.reconciliationText'],
] as const;

const TECHNICAL_ITEMS = [
  ['einv.technical.auth', 'einv.technical.authText'],
  ['einv.technical.format', 'einv.technical.formatText'],
  ['einv.technical.fiscal', 'einv.technical.fiscalText'],
  ['einv.technical.offline', 'einv.technical.offlineText'],
  ['einv.technical.numbering', 'einv.technical.numberingText'],
  ['einv.technical.environments', 'einv.technical.environmentsText'],
] as const;

const SECURITY_ITEMS = [
  'einv.security.secrets',
  'einv.security.storage',
  'einv.security.audit',
  'einv.security.rights',
  'einv.security.retention',
  'einv.security.incidents',
] as const;

export default function MraEInvoicingPage() {
  const { t } = useI18n();

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="page-sub">{t('module.billing')} · {t('einv.breadcrumb')}</div>
          <h1>{t('einv.title')}</h1>
          <p className="page-sub">{t('einv.subtitle')}</p>
        </div>
        <Badge kind="warning">{t('einv.badge')}</Badge>
      </div>

      <section className="mra-hero" aria-labelledby="mra-hero-title">
        <div className="mra-hero-copy">
          <span className="mra-kicker">{t('einv.kicker')}</span>
          <h2 id="mra-hero-title">{t('einv.heroTitle')}</h2>
          <p>{t('einv.heroText')}</p>
          <p className="mra-hero-note">{t('einv.heroNote')}</p>
          <div className="mra-hero-actions">
            <Link className="btn mra-hero-button" to="/billing/invoices">
              {t('einv.openBilling')}
            </Link>
          </div>
        </div>
        <div className="mra-status-card" role="status">
          <span className="mra-status-label">{t('einv.statusLabel')}</span>
          <strong>{t('einv.statusValue')}</strong>
          <span>{t('einv.statusHint')}</span>
        </div>
      </section>

      <div className="alert alert-warning" role="note">
        <strong>{t('einv.notEnabled')}</strong> {t('einv.notEnabledDetail')}
      </div>

      <div className="kpi-grid mra-kpis">
        <div className="kpi">
          <div className="kpi-label">{t('einv.kpi.registration')}</div>
          <div className="kpi-value">{t('einv.kpi.registrationValue')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('einv.kpi.certification')}</div>
          <div className="kpi-value">{t('einv.kpi.certificationValue')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('einv.kpi.api')}</div>
          <div className="kpi-value">{t('einv.kpi.apiValue')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('einv.kpi.data')}</div>
          <div className="kpi-value">{t('einv.kpi.dataValue')}</div>
        </div>
      </div>

      <div className="split">
        <Card title={t('einv.scopeTitle')}>
          <p>{t('einv.scopeClassic')}</p>
          <p>{t('einv.scopeNotSecond')}</p>
          <p className="page-sub">{t('einv.scopePermissions')}</p>
        </Card>

        <Card title={t('einv.adminTitle')}>
          <ul className="mra-checklist">
            <li><span className="mra-dot" aria-hidden="true">1</span><span>{t('einv.admin.company')}</span></li>
            <li><span className="mra-dot" aria-hidden="true">2</span><span>{t('einv.admin.registration')}</span></li>
            <li><span className="mra-dot" aria-hidden="true">3</span><span>{t('einv.admin.clients')}</span></li>
            <li><span className="mra-dot" aria-hidden="true">4</span><span>{t('einv.admin.records')}</span></li>
            <li><span className="mra-dot" aria-hidden="true">5</span><span>{t('einv.admin.noRealData')}</span></li>
          </ul>
          <p className="page-sub mra-card-note">{t('einv.adminNotice')}</p>
        </Card>
      </div>

      <Card title={t('einv.roadmapTitle')}>
        <p className="page-sub">{t('einv.roadmapIntro')}</p>
        <ol className="mra-roadmap">
          {PREPARATION_STEPS.map(([title, text], index) => (
            <li key={title}>
              <span className="mra-step-number" aria-hidden="true">{index + 1}</span>
              <div>
                <h3>{t(title)}</h3>
                <p>{t(text)}</p>
              </div>
              <Badge kind="neutral">{t('einv.notStarted')}</Badge>
            </li>
          ))}
        </ol>
      </Card>

      <Card title={t('einv.featuresTitle')}>
        <p className="page-sub">{t('einv.featuresIntro')}</p>
        <div className="mra-feature-grid">
          {FEATURES.map(([icon, title, text]) => (
            <article className="mra-feature" key={title}>
              <span className="mra-feature-icon" aria-hidden="true">{icon}</span>
              <h3>{t(title)}</h3>
              <p>{t(text)}</p>
              <Badge kind="neutral">{t('einv.unavailable')}</Badge>
            </article>
          ))}
        </div>
        <p className="mra-limitation" role="note">{t('einv.unavailableNote')}</p>
      </Card>

      <div className="split">
        <Card title={t('einv.technicalTitle')}>
          <p className="page-sub">{t('einv.technicalIntro')}</p>
          <ul className="mra-checklist mra-checklist-compact">
            {TECHNICAL_ITEMS.map(([title, text]) => (
              <li key={title}>
                <span className="mra-dot mra-dot-outline" aria-hidden="true">?</span>
                <span><strong>{t(title)}</strong> — {t(text)}</span>
              </li>
            ))}
          </ul>
          <p className="mra-limitation">{t('einv.technicalStatus')}</p>
        </Card>

        <Card title={t('einv.securityTitle')}>
          <ul className="mra-checklist mra-checklist-compact">
            {SECURITY_ITEMS.map((key) => (
              <li key={key}>
                <span className="mra-dot" aria-hidden="true">✓</span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="page-sub mra-card-note">{t('einv.securityNotice')}</p>
        </Card>
      </div>

      <Card title={t('einv.settingsTitle')}>
        <p className="page-sub">{t('einv.settingsIntro')}</p>
        <div className="mra-settings" role="group" aria-label={t('einv.settingsTitle')}>
          <div className="form-grid">
            <Field label={t('einv.settings.environment')}>
              <select value={t('einv.settings.environmentValue')} disabled onChange={() => undefined}>
                <option>{t('einv.settings.environmentValue')}</option>
              </select>
            </Field>
            <Field label={t('einv.settings.ebsId')}>
              <input value={t('einv.settings.ebsIdValue')} disabled readOnly />
            </Field>
            <Field label={t('einv.settings.certificate')}>
              <input value={t('einv.settings.certificateValue')} disabled readOnly />
            </Field>
            <Field label={t('einv.settings.endpoint')}>
              <input value={t('einv.settings.endpointValue')} disabled readOnly />
            </Field>
          </div>
          <div className="mra-settings-actions">
            <Button disabled title={t('einv.settings.disabled')}>{t('einv.settings.test')}</Button>
            <Button variant="primary" disabled title={t('einv.settings.disabled')}>
              {t('einv.settings.save')}
            </Button>
          </div>
        </div>
        <p className="mra-limitation" role="note">{t('einv.settings.noSecrets')}</p>
      </Card>

      <Card title={t('einv.glossaryTitle')}>
        <p className="page-sub">{t('einv.glossaryIntro')}</p>
        <dl className="definition mra-definition">
          <dt>{t('einv.term.ebs')}</dt>
          <dd>{t('einv.term.ebsText')}</dd>
          <dt>{t('einv.term.ifp')}</dt>
          <dd>{t('einv.term.ifpText')}</dd>
          <dt>{t('einv.term.irn')}</dt>
          <dd>{t('einv.term.irnText')}</dd>
        </dl>
        <p className="page-sub">{t('einv.glossaryNote')}</p>
        <p className="page-sub">{t('einv.referencesText')}</p>
      </Card>

      <div className="alert alert-info" role="note">
        <strong>{t('einv.classicTitle')}</strong> {t('einv.classicText')}{' '}
        <Link to="/billing/invoices">{t('einv.classicLink')}</Link>
      </div>

      <p className="mra-disclaimer">{t('einv.noCertification')}</p>
    </>
  );
}
