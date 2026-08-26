import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import type { Toast, ToastVariant } from '../context/ToastContext';

/**
 * The visual half of the toast system (state lives in ToastContext).
 *
 * Rendered through a portal onto `document.body` rather than in place: the
 * app shell is a `h-screen` flex column whose panes are `overflow-y-auto`,
 * and several screens sit inside `sticky`/`transform` ancestors, any of which
 * would clip a `fixed` child or trap it in a lower stacking context.
 *
 * Layering: modals in this app are `z-[60]`, so the stack is `z-[70]` — a
 * toast announcing something that arrived while a modal is open still has to
 * be visible. The container itself is `pointer-events-none` so it never
 * blocks clicks on the app behind it; each card re-enables them for itself.
 */

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/** How long the slide-out runs before the card is actually unmounted. */
const EXIT_MS = 180;

const VARIANT_META: Record<ToastVariant, { icon: React.ElementType; iconClass: string; accent: string }> = {
  // The reserved status pairs from index.css, used for their actual purpose
  // (state), each paired with an icon so the meaning never rests on colour
  // alone.
  info: { icon: Bell, iconClass: 'bg-collab-bg text-collab-fg', accent: 'bg-collab-fg' },
  success: { icon: CheckCircle2, iconClass: 'bg-done-bg text-done-fg', accent: 'bg-done-fg' },
  warning: { icon: AlertTriangle, iconClass: 'bg-run-bg text-run-fg', accent: 'bg-run-fg' },
  error: { icon: XCircle, iconClass: 'bg-late-bg text-late-fg', accent: 'bg-late-fg' },
};

const ToastCard: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | null>(null);
  /** Time left on the clock, so hovering pauses rather than restarts it. */
  const remaining = useRef(toast.duration);
  const startedAt = useRef(Date.now());

  const meta = VARIANT_META[toast.variant];
  const Icon = meta.icon;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setLeaving(true);
    // Let the exit animation finish before the row leaves the flex column,
    // otherwise the cards below snap upward mid-slide.
    window.setTimeout(() => onDismiss(toast.id), EXIT_MS);
  }, [clearTimer, onDismiss, toast.id]);

  const resume = useCallback(() => {
    if (toast.duration <= 0) return;
    clearTimer();
    startedAt.current = Date.now();
    timer.current = window.setTimeout(close, Math.max(0, remaining.current));
  }, [clearTimer, close, toast.duration]);

  const pause = useCallback(() => {
    if (toast.duration <= 0) return;
    clearTimer();
    remaining.current -= Date.now() - startedAt.current;
  }, [clearTimer, toast.duration]);

  useEffect(() => {
    resume();
    return clearTimer;
    // Mount only: the timer owns its own lifecycle from here via pause/resume.
  }, []);

  const clickable = typeof toast.onClick === 'function';

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={pause}
      onMouseLeave={resume}
      // A touch device has no hover, so holding the card is the equivalent
      // gesture for "wait, I'm reading this".
      onTouchStart={pause}
      onTouchEnd={resume}
      className={`group pointer-events-auto relative flex w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ${
        leaving ? 'animate-[toastOut_180ms_ease-in_forwards]' : 'animate-[toastIn_200ms_cubic-bezier(0.16,1,0.3,1)]'
      }`}
    >
      {/* Colour strip: identifies the kind at a glance without tinting the
          whole card, which would hurt the text contrast. */}
      <span className={`w-1 shrink-0 ${meta.accent}`} aria-hidden="true" />

      <div
        onClick={clickable ? () => { toast.onClick?.(); close(); } : undefined}
        className={`flex min-w-0 flex-1 items-start gap-3 py-3 pl-3 pr-2 ${clickable ? 'cursor-pointer hover:bg-gray-50' : ''}`}
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.iconClass}`}>
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[12.5px] font-semibold text-gray-900">{toast.title}</p>
          {toast.body && (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-gray-500">{toast.body}</p>
          )}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); close(); }}
          className="-mr-0.5 shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Fermer"
          aria-label="Fermer la notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Countdown; pauses with the timer so the bar never disagrees with it. */}
      {toast.duration > 0 && (
        <span
          aria-hidden="true"
          className={`absolute bottom-0 left-0 h-0.5 w-full origin-left ${meta.accent} opacity-30 group-hover:[animation-play-state:paused]`}
          style={{ animation: `toastProgress ${toast.duration}ms linear forwards` }}
        />
      )}
    </div>
  );
};

export const ToastStack: React.FC<ToastStackProps> = ({ toasts, onDismiss }) => {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      // Sits just under the 60px header on every size, on the same side as
      // the bell that owns these notifications. Full-bleed between gutters on
      // a phone, a fixed column from `sm` up — same stack, same order, same
      // behaviour, only the width changes.
      className="pointer-events-none fixed inset-x-3 top-[68px] z-[70] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-[380px]"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
};
