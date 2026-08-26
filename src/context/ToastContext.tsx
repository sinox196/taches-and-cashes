import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ToastStack } from '../components/ToastStack';

/**
 * In-app toast notifications — the pop-up card that slides in under the
 * header, stacks vertically, and dismisses itself after a few seconds.
 *
 * This sits *alongside* the OS notifications in `src/utils/osNotifications.ts`,
 * it does not replace them. The two solve different halves of the same
 * problem and fail in different places:
 *
 * - An OS toast reaches the user when the app is not the focused window, but
 *   it is silently dropped whenever permission was never granted or was
 *   refused — which is the majority case, since the browser only asks once.
 * - An in-app toast always renders (no permission exists to refuse) but only
 *   while the app is on screen.
 *
 * So both fire for the same event, from the same place in NotificationBell.
 * Neither is authoritative: the bell's list stays the record of what arrived,
 * and a toast is a transient announcement of it.
 */

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  body?: string;
  variant?: ToastVariant;
  /** ms until auto-dismiss. 0 keeps it up until closed by hand. */
  duration?: number;
  /**
   * Collapses a repeat of the same subject onto the existing toast rather
   * than stacking a second one — same role as the `tag` on an OS
   * notification. Five messages from one contact are one toast, not five.
   */
  tag?: string;
  /** Makes the card clickable, e.g. to navigate to the relevant section. */
  onClick?: () => void;
}

export interface Toast extends ToastInput {
  id: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * Hard cap on what is on screen at once. A burst (the 20s poll returning
 * several new rows) must not paper over the app — anything past this drops
 * the oldest, which is still in the bell's list.
 */
const MAX_VISIBLE = 4;

const DEFAULT_DURATION = 5000;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    // Date.now() alone collides when two arrive in the same millisecond,
    // which a single poll returning several rows does routinely.
    const id = `toast-${Date.now()}-${(seq.current += 1)}`;
    const toast: Toast = {
      ...input,
      id,
      variant: input.variant ?? 'info',
      duration: input.duration ?? DEFAULT_DURATION,
    };
    setToasts((prev) => {
      const withoutSameTag = input.tag ? prev.filter((t) => t.tag !== input.tag) : prev;
      // Newest first: the stack is anchored at the top, so a new card
      // appears at the top and pushes the others down.
      return [toast, ...withoutSameTag].slice(0, MAX_VISIBLE);
    });
    return id;
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
