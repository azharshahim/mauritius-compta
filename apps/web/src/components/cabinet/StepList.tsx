import { Badge } from '../ui';
import { AppIcon } from '../AppIcon';
import { useI18n } from '../../i18n';
import { statusKind, statusLabelKey } from '../../cabinet/workspace';

/**
 * Six-step progress rail of the guided onboarding. Used by the creation
 * assistant (the six steps are navigable) and by the client onboarding editor
 * (the checklist status comes from the server).
 */
export const ONBOARDING_STEP_KEYS = [
  'company_information',
  'kyc',
  'sector',
  'accounting_setup',
  'modules',
  'activation',
] as const;

export function StepList({
  steps,
  current,
  onSelect,
  oneline = false,
}: {
  steps: { key: string; status: string; percent?: number }[];
  current?: string;
  onSelect?: (key: string) => void;
  oneline?: boolean;
}) {
  const { t } = useI18n();
  return (
    <ol className={`m44-steps ${oneline ? 'm44-steps-oneline' : ''}`} aria-label={t('m44.steps.aria')}>
      {steps.map((step, index) => {
        const active = current === step.key;
        const completed = step.status === 'completed';
        const content = (
          <>
            <span className="m44-step-index" aria-hidden="true">
              {completed ? <AppIcon name="check" size={14} /> : index + 1}
            </span>
            <span className="m44-step-text">
              <span className="m44-step-title">{t(`m44.step.${step.key}`)}</span>
              <Badge kind={statusKind(step.status)}>{t(statusLabelKey(step.status))}</Badge>
            </span>
          </>
        );
        return (
          <li key={step.key} className={`m44-step ${active ? 'active' : ''} m44-step-${step.status}`}>
            {onSelect ? (
              <button
                type="button"
                className="m44-step-button"
                aria-current={active ? 'step' : undefined}
                onClick={() => onSelect(step.key)}
              >
                {content}
              </button>
            ) : (
              <div className="m44-step-button">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Thin, accessible progress bar. The percentage is always server-computed. */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const { t } = useI18n();
  return (
    <div
      className="m44-progress m44-progress-large"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label ?? t('m44.progress.aria')}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}
