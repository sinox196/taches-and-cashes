import { useEffect } from 'react';

/**
 * Closes a modal on Escape. There's no shared Modal wrapper in this codebase
 * (every dialog is a hand-rolled `fixed inset-0` overlay), so this is called
 * directly from each modal component instead.
 *
 * `enabled` matters because several modal components stay mounted and only
 * conditionally render (an `isOpen` prop, `return null` past the hooks) —
 * without it, a closed-but-mounted modal would still swallow Escape.
 */
export function useEscapeToClose(onClose: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, enabled]);
}
