import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { AppIcon } from './AppIcon';

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
