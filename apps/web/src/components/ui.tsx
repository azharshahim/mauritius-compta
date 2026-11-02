import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { AppIcon } from './AppIcon';
import type { IconName } from './AppIcon';

export type BadgeKind = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'teal' | 'violet';
export type KpiTone = 'primary' | 'teal' | 'violet' | 'success' | 'warning' | 'danger';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || actions || subtitle) && (
        <header className="card-head">
          <div className="card-head-main">
            {title && <h2>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={`card-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function PageHeader({
  kicker,
  title,
  subtitle,
  meta,
  actions,
  className = '',
}: {
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`page-head ${className}`.trim()}>
      <div className="grow page-head-copy">
        {kicker && <div className="m44-kicker">{kicker}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

export function KpiCard({
  label,
  value,
  detail,
  icon,
  tone = 'primary',
  valueTone,
  className = '',
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
  tone?: KpiTone;
  valueTone?: 'positive' | 'negative';
  className?: string;
}) {
  const toneClass =
    tone === 'danger'
      ? 'kpi-danger'
      : tone === 'warning'
        ? 'kpi-warning'
        : tone === 'teal'
          ? 'kpi-teal'
          : tone === 'violet'
            ? 'kpi-violet'
            : tone === 'success'
              ? 'kpi-success'
              : '';
  return (
    <div className={`kpi ${toneClass} ${className}`.trim()}>
      <div className="kpi-head">
        <div className="kpi-label">{label}</div>
        {icon && (
          <span className="kpi-icon">
            <AppIcon name={icon} size={17} />
          </span>
        )}
      </div>
      <div className={`kpi-value mono${valueTone ? ` ${valueTone}` : ''}`}>{value}</div>
      {detail && <div className="m44-kpi-detail">{detail}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = 'default',
  size,
  type = 'button',
  onClick,
  disabled,
  className = '',
  title,
  ariaLabel,
}: {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${size === 'sm' ? ' btn-sm' : ''} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
}) {
  return (
    <label className={`field${className ? ` ${className}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Badge({ kind = 'neutral', children }: { kind?: BadgeKind; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: IconName;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && (
        <div className="empty-icon">
          <AppIcon name={icon} size={20} />
        </div>
      )}
      <p className="empty-title">{title}</p>
      {children && <div className="empty-copy">{children}</div>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}

export function NoticeBanner({
  kind = 'info',
  title,
  children,
  actions,
  className = '',
}: {
  kind?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const alertClass = kind === 'info' ? 'alert-info' : kind === 'success' ? 'alert-success' : kind === 'warning' ? 'alert-warning' : 'alert-danger';
  return (
    <div className={`alert ${alertClass} notice-banner ${className}`.trim()} role={kind === 'danger' ? 'alert' : 'status'}>
      <div className="notice-banner-main">
        {title && <strong className="notice-banner-title">{title}</strong>}
        <div>{children}</div>
      </div>
      {actions && <div className="notice-banner-actions">{actions}</div>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert">
      {message || t('common.error')}
    </div>
  );
}

export function DemoNotice() {
  const { t } = useI18n();
  return <div className="demo-notice">{t('common.demoNotice')}</div>;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dirtyRef = useRef(false);

  // The close handler is usually an inline arrow: keep it in a ref so that a
  // parent re-render (one per keystroke in a controlled field) does not re-run
  // the focus effect below. Re-running it moved focus from the input to the
  // dialog on every character, which made Android dismiss the virtual
  // keyboard after the first letter.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Keep the translator current without re-running the focus/dirty effect when
  // the interface language changes while a dialog is open.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const requestCloseRef = useRef<() => void>(() => undefined);
  requestCloseRef.current = () => {
    if (dirtyRef.current) {
      if (typeof window.confirm === 'function' && !window.confirm(tRef.current('nav.unsavedConfirm'))) return;
      dirtyRef.current = false;
    }
    onCloseRef.current();
  };

  // Runs once per open/close. Escape closes; focus enters the dialog only if it
  // is not already inside it, and returns to the triggering element on close.
  useEffect(() => {
    if (!open) {
      dirtyRef.current = false;
      return;
    }
    dirtyRef.current = false;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      // Keyboard trap: keep Tab and Shift+Tab inside the dialog. Native focus
      // still works on Android and with assistive technologies.
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    const dialog = dialogRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (dialog && !(active && dialog.contains(active))) {
      openerRef.current = active;
      dialog.focus({ preventScroll: true });
    }

    return () => {
      window.removeEventListener('keydown', onKey);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  const markDirty = (event: React.SyntheticEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.matches('input, select, textarea')) {
      dirtyRef.current = true;
      dialogRef.current?.setAttribute('data-nav-dirty', 'true');
    }
  };
  return (
    <div className="modal-backdrop" onClick={() => requestCloseRef.current()} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onChangeCapture={markDirty}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={() => requestCloseRef.current()} aria-label={t('common.close')}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  return (
    <div className="pagination">
      <button className="btn btn-ghost" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        ‹
      </button>
      <span>
        {page} / {pages}
      </span>
      <button
        className="btn btn-ghost"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        ›
      </button>
    </div>
  );
}
