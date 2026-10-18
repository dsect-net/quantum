/**
 * Shared UI primitives — the Singularity component kit. Small, typed,
 * accessible (44px touch floor, focus-visible styles live in styles.css).
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { initials as toInitials } from '../lib/format';
import type { UserCard } from '../api/types';

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: 'accent' | 'muted' | 'ok' | 'warn' | 'danger';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Avatar({
  user,
  size = 'md',
}: {
  user: Pick<UserCard, 'display_name' | 'avatar_data' | 'avatar_url'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = `avatar${size === 'sm' ? ' avatar-sm' : size === 'lg' ? ' avatar-lg' : ''}`;
  const src = user.avatar_data ?? user.avatar_url;
  return (
    <div className={cls} aria-hidden="true">
      {src ? <img src={src} alt="" /> : toInitials(user.display_name)}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {hint ? <p className="small">{hint}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function StatusBanner({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'err';
  children: ReactNode;
}) {
  return <div className={`status-banner ${tone}`}>{children}</div>;
}

/** Simple toast host — mounted once by App. */
export interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = (message: string, tone: ToastItem['tone'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((item) => item.id !== id));
    }, 4200);
  };

  const host = (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'error' ? ' error' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );

  return { push, host };
}

/**
 * Bottom sheet — the memory detail / picker surface. Closes on backdrop
 * click and Escape; traps nothing fancy (single-sheet app).
 */
export function Sheet({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <div className="sheet-grip" />
        {children}
      </div>
    </div>
  );
}
