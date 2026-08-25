import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, MessageCircle, ClipboardCheck, CalendarDays, CalendarClock, Clock4, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * The one notification surface in the app: unread messages (from the same
 * contacts data ChatPage already reads — no second "unread" bookkeeping) and
 * the generic per-user `notifications` collection (task assigned, HR
 * requests/decisions). Polled on the same 20s cadence the sidebar's message
 * badge already used, so this adds one extra request per tick, not a new
 * polling loop.
 */

interface NotificationBellProps {
  /** Switches the active sidebar section — Header has no navigation of its own. */
  onNavigate: (section: string) => void;
}

const TYPE_META: Record<string, { icon: React.ElementType; nav: string; iconClass: string }> = {
  TASK_ASSIGNED: { icon: ClipboardCheck, nav: 'Dashboard', iconClass: 'bg-blue-50 text-blue-600' },
  TASK_REMINDER: { icon: CalendarClock, nav: 'Dashboard', iconClass: 'bg-purple-50 text-purple-600' },
  LEAVE_REQUEST: { icon: CalendarDays, nav: 'HR', iconClass: 'bg-amber-50 text-amber-600' },
  LEAVE_DECISION: { icon: CalendarDays, nav: 'HR', iconClass: 'bg-emerald-50 text-emerald-600' },
  ABSENCE_REQUEST: { icon: Clock4, nav: 'HR', iconClass: 'bg-amber-50 text-amber-600' },
  ABSENCE_DECISION: { icon: Clock4, nav: 'HR', iconClass: 'bg-emerald-50 text-emerald-600' },
};

/** "il y a 5 min" — coarse on purpose, this is a notification list, not a log. */
const relativeTime = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
};

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigate }) => {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [contacts, setContacts] = useState<any[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [notifRes, contactsRes] = await Promise.all([
        fetch('/api/notifications', { headers }),
        fetch('/api/messages/contacts', { headers }),
      ]);
      if (notifRes.ok) {
        const body = await notifRes.json();
        setItems(body.items ?? []);
        setUnreadCount(body.unreadCount ?? 0);
      }
      if (contactsRes.ok) setContacts(await contactsRes.json());
    } catch {
      /* a missed poll just delays the badge, never worth surfacing */
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const unreadMessageContacts = contacts.filter((c) => c.unreadCount > 0);
  const messagesTotal = unreadMessageContacts.reduce((s, c) => s + c.unreadCount, 0);
  const badgeTotal = unreadCount + messagesTotal;

  const openNotification = async (n: any) => {
    setOpen(false);
    onNavigate(TYPE_META[n.type]?.nav ?? 'Dashboard');
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await fetch(`/api/notifications/${n.id}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      } catch { /* the next poll reconciles it either way */ }
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await fetch('/api/notifications/read-all', { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
    } catch { /* next poll reconciles */ }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1 text-gray-500 hover:text-gray-800 rounded transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {badgeTotal > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 border border-white text-white text-[9px] font-bold flex items-center justify-center">
            {badgeTotal > 99 ? '99+' : badgeTotal}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[13px] font-bold text-gray-900">Notifications</span>
            {badgeTotal > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Tout marquer comme lu
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
            {unreadMessageContacts.map((c) => (
              <button
                key={`msg-${c.id}`}
                onClick={() => { setOpen(false); onNavigate('Messages'); }}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-gray-900 truncate">{c.fullName}</span>
                  <span className="block text-[11.5px] text-gray-500">
                    {c.unreadCount} message{c.unreadCount > 1 ? 's' : ''} non lu{c.unreadCount > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="ml-auto w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
              </button>
            ))}

            {items.map((n) => {
              const meta = TYPE_META[n.type] ?? { icon: Bell, nav: 'Dashboard', iconClass: 'bg-gray-100 text-gray-500' };
              const Icon = meta.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${meta.iconClass}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[12.5px] truncate ${!n.readAt ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'}`}>
                      {n.title}
                    </span>
                    <span className="block text-[11.5px] text-gray-500 line-clamp-2">{n.body}</span>
                    <span className="block text-[10px] text-gray-400 mt-0.5">{relativeTime(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="ml-auto w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                </button>
              );
            })}

            {unreadMessageContacts.length === 0 && items.length === 0 && (
              <p className="px-4 py-8 text-center text-[12px] text-gray-400 italic">Aucune notification.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
