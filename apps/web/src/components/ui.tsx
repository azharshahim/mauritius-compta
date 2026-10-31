import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Button({
  children,
  variant = 'default',
  type = 'button',
  onClick,
  disabled,
  className = '',
  title,
}: {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'link';
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
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
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Badge({ kind = 'neutral', children }: { kind?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
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

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
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

  // The close handler is usually an inline arrow: keep it in a ref so that a
  // parent re-render (one per keystroke in a controlled field) does not re-run
  // the focus effect below. Re-running it moved focus from the input to the
  // dialog on every character, which made Android dismiss the virtual
  // keyboard after the first letter.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Runs once per open/close. Escape closes; focus enters the dialog only if it
  // is not already inside it, and returns to the triggering element on close.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
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
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
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
