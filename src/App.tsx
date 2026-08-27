import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ActiveTimerCard } from './components/ActiveTimerCard';
import { FloatingTimer } from './components/FloatingTimer';
import { showTimerNotification, closeTimerNotification } from './utils/osNotifications';
import { NewTaskCard } from './components/NewTaskCard';
import { TimeTrackingTable } from './components/TimeTrackingTable';
import { PausedTasksList } from './components/PausedTasksList';
import { EditTaskModal } from './components/EditTaskModal';
import { AssignTaskModal } from './components/AssignTaskModal';
import { PlanTaskModal } from './components/PlanTaskModal';
import { AdminDashboard } from './components/dashboard/AdminDashboard';
import { MyDashboard } from './components/dashboard/MyDashboard';
import { ChatPage } from './components/chat/ChatPage';
import { UsersManagement } from './components/UsersManagement';
import { ClientsManagement } from './components/clients/ClientsManagement';
import { HRManagement } from './components/hr/HRManagement';
import { MissionsManagement } from './components/missions/MissionsManagement';
import { CashManagement } from './components/cash/CashManagement';
import { ResourcesManagement } from './components/resources/ResourcesManagement';
import { useAuth } from './context/AuthContext';
import { DASHBOARD_ROLES } from './constants/roles';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { PlatformAdmin } from './pages/PlatformAdmin';
import { ResetPassword } from './pages/ResetPassword';
import { Loader2, ClipboardCheck, CalendarClock } from 'lucide-react';

import {
  INITIAL_CLIENTS,
  INITIAL_SERVICES,
} from './data/initialData';
import { TimeEntry, ActiveTimerState } from './types';
import {
  formatHHMMSS,
  formatVerboseDuration,
  calculateCostDT,
} from './utils/formatters';

export default function App() {
  const { user, token, isLoading, hasPermission } = useAuth();

  // Shown only while logged out — the public marketing/pricing page, or the
  // login form reached from it via "Se connecter". Distinct from
  // activeSidebarItem, which only ever applies to the authenticated shell.
  const [publicScreen, setPublicScreen] = useState<'landing' | 'login'>('landing');

  // The app has no router, but the "mot de passe oublié" email links back to
  // this same URL with ?reset=<token> — read once at mount, ahead of the
  // normal logged-in/logged-out split, since this screen applies regardless
  // of whether a session already exists in this browser.
  const [resetToken, setResetToken] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('reset')
  );

  // Remember the current section so a refresh (or anything that remounts the
  // app) leaves you where you were instead of bouncing back to Pointage.
  const NAV_IDS = ['Dashboard', 'Clients', 'Time Tracking', 'Messages', 'Missions', 'Ressources', 'Cash', 'HR', 'Users', 'Plateforme'];
  const [activeSidebarItem, setActiveSidebarItem] = useState(() => {
    // Clicking a pushed notification with no tab open makes the service
    // worker open the app at `/?nav=<section>` — there's no router to read a
    // URL otherwise, so it's consumed once here and stripped, or a later
    // refresh would keep dragging the user back to that section.
    const fromPush = new URLSearchParams(window.location.search).get('nav');
    if (fromPush && NAV_IDS.includes(fromPush)) {
      window.history.replaceState({}, '', window.location.pathname);
      return fromPush;
    }
    const saved = localStorage.getItem('active_nav');
    return saved && NAV_IDS.includes(saved) ? saved : 'Time Tracking';
  });

  useEffect(() => {
    localStorage.setItem('active_nav', activeSidebarItem);
  }, [activeSidebarItem]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [servicesList, setServicesList] = useState<any[]>([]);
  const [taskTypesList, setTaskTypesList] = useState<any[]>([]);
  /** Entries that exist server-side, of which the table holds the most recent page. */
  const [totalEntries, setTotalEntries] = useState<number | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Sidebar badge: polled as a fallback and updated live by ChatPage's own
  // SSE stream (via onUnreadChange) whenever the Messages page is open.
  useEffect(() => {
    if (!token) return;
    const fetchUnread = () => {
      fetch('/api/messages/unread-count', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => { if (typeof data?.count === 'number') setUnreadMessages(data.count); })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 20000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (token) {
      // Clients are NOT preloaded: with hundreds of them this fetch ran on
      // every navigation just to feed one autocomplete. NewTaskCard queries
      // /api/clients?q= as you type instead.
      fetch('/api/services', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setServicesList(data);
        }).catch(console.error);

      fetch('/api/task-types', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setTaskTypesList(data);
        }).catch(console.error);
    }
  }, [token, activeSidebarItem]);

  // Cost comes from the collaborator's employer hourly cost. When they have
  // none configured we show a dash rather than pricing the work at a guess.
  const decorate = (entry: any): TimeEntry => ({
    ...entry,
    duree: formatVerboseDuration(entry.dureeSeconds || 0),
    coutCalcule:
      entry.hourlyRate == null
        ? '—'
        : calculateCostDT(entry.dureeSeconds || 0, entry.hourlyRate),
  });

  // The server returns a capped, newest-first page plus the overall total, so a
  // large history never lands in one payload.
  const fetchTimeEntries = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/time-entries', { headers: { 'Authorization': `Bearer ${token}` } });
      const body = await res.json();
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      setTimeEntries(rows.map(decorate));
      if (!Array.isArray(body) && typeof body.total === 'number') setTotalEntries(body.total);
    } catch (e) {
      console.error(e);
    }
  }, [token]);

  useEffect(() => {
    if (!token || activeSidebarItem !== 'Time Tracking') return;

    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;

    // Initial fetch to avoid SSE delay
    fetchTimeEntries();

    const connect = () => {
      if (closed) return;
      source = new EventSource(`/api/time-entries/stream?token=${token}`);

      source.onopen = () => {
        retries = 0;
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const data = Array.isArray(payload) ? payload : (payload.data ?? []);
          if (!Array.isArray(payload) && typeof payload.total === 'number') setTotalEntries(payload.total);
          setTimeEntries(prev => {
            return data.map((serverEntry: any) => {
              if (serverEntry.statut === 'RUNNING') {
                const local = prev.find(e => e.id === serverEntry.id);
                // if we already have it running locally, keep our local seconds if it's within a reasonable drift (e.g. 5s) to avoid UI stutter
                if (local && local.statut === 'RUNNING') {
                  if (Math.abs(local.dureeSeconds - serverEntry.dureeSeconds) < 5) {
                     return { ...serverEntry, dureeSeconds: local.dureeSeconds, duree: local.duree, coutCalcule: local.coutCalcule };
                  }
                }
              }
              return decorate(serverEntry);
            });
          });
        } catch (e) {
          console.error('SSE Error:', e);
        }
      };

      // The stream dying used to leave the UI frozen on stale data: the local
      // 1s tick kept counting while pause/stop never made it back to the
      // screen. Always reconnect (with backoff) and resync on reconnect.
      source.onerror = () => {
        if (closed) return;
        source?.close();
        source = null;
        const delay = Math.min(1000 * 2 ** retries, 15000);
        retries += 1;
        retryTimer = setTimeout(() => {
          fetchTimeEntries();
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [token, activeSidebarItem, fetchTimeEntries]);

  /**
   * Off Pointage there is no SSE stream (it pushes a whole page of every
   * user's entries — far too much to hold open on every screen), so the
   * floating chronometer keeps itself fresh from the one-row
   * /api/time-entries/active instead. The local 1s tick below does the
   * counting; this poll only has to catch changes made elsewhere (another
   * device, or an admin pausing your task), hence 30s rather than a
   * second-by-second refresh.
   */
  useEffect(() => {
    if (!token || activeSidebarItem === 'Time Tracking') return;

    let cancelled = false;
    const syncActive = async () => {
      try {
        const res = await fetch('/api/time-entries/active', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return;
        const { entry } = await res.json();
        if (cancelled) return;
        setTimeEntries(prev => {
          // Nothing of mine is running or paused any more: drop my stale rows
          // so the widget can't keep counting a task that has been stopped.
          if (!entry) return prev.filter(e => !(e.userId === user?.id && e.statut !== 'COMPLETED'));
          const local = prev.find(e => e.id === entry.id);
          // Same <5s drift rule the SSE handler uses: keep the local count
          // when it broadly agrees, so the display doesn't visibly stutter.
          const merged =
            local && local.statut === 'RUNNING' && entry.statut === 'RUNNING'
              && Math.abs(local.dureeSeconds - entry.dureeSeconds) < 5
              ? { ...entry, dureeSeconds: local.dureeSeconds, duree: local.duree, coutCalcule: local.coutCalcule }
              : decorate(entry);
          return local
            ? prev.map(e => (e.id === merged.id ? merged : e))
            : [merged, ...prev];
        });
      } catch {
        // A failed poll is not worth surfacing: the next one is 30s away and
        // the tick keeps the display alive in the meantime.
      }
    };

    syncActive();
    const interval = setInterval(syncActive, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, activeSidebarItem, user?.id]);

  /**
   * The task the user paused during this session — what keeps the floating
   * chronometer on screen (in paused state) after a pause, so resuming stays
   * one click away. Session-scoped on purpose: a reload starts clean rather
   * than resurrecting an old paused task into the corner of every page.
   */
  const [justPausedId, setJustPausedId] = useState<string | null>(null);

  /** Mobile nav drawer. Has no effect from `lg` up, where the rail is static. */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [isAssignTaskOpen, setIsAssignTaskOpen] = useState(false);
  const [isPlanTaskOpen, setIsPlanTaskOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Interval timer tick: Update running durations locally
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeEntries((entries) =>
        entries.map((entry) => {
          if (entry.statut === 'RUNNING') {
            const nextSecs = entry.dureeSeconds + 1;
            return {
              ...entry,
              dureeSeconds: nextSecs,
              duree: formatVerboseDuration(nextSecs),
              coutCalcule:
                entry.hourlyRate == null
                  ? '—'
                  : calculateCostDT(nextSecs, entry.hourlyRate)
            };
          }
          return entry;
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Overtime alert: every full 2h a task runs continuously, ask the
  // collaborator whether they're still on it. Responding keeps it running;
  // ignoring it for the grace period below pauses it automatically. Re-fires
  // at every subsequent 2h boundary (4h, 6h, …), not just once, since a task
  // left running for a whole afternoon is exactly the case this exists for.
  const OVERTIME_THRESHOLD_SECONDS = 2 * 3600;
  const OVERTIME_GRACE_MS = 2 * 60 * 1000;
  const [overtimeAlert, setOvertimeAlert] = useState<{ entryId: string; deadline: number } | null>(null);
  const [overtimeSecondsLeft, setOvertimeSecondsLeft] = useState(0);
  const acknowledgedOvertimeRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const myRunning = timeEntries.find(e => e.userId === user?.id && e.statut === 'RUNNING');
    if (!myRunning) { setOvertimeAlert(null); return; }
    const cycles = Math.floor(myRunning.dureeSeconds / OVERTIME_THRESHOLD_SECONDS);
    if (cycles < 1) return;
    const acknowledged = acknowledgedOvertimeRef.current[myRunning.id] || 0;
    if (cycles > acknowledged && !overtimeAlert) {
      setOvertimeAlert({ entryId: myRunning.id, deadline: Date.now() + OVERTIME_GRACE_MS });
    }
  }, [timeEntries, user?.id]);

  useEffect(() => {
    if (!overtimeAlert) return;
    const tick = () => setOvertimeSecondsLeft(Math.max(0, Math.ceil((overtimeAlert.deadline - Date.now()) / 1000)));
    tick();
    const countdown = setInterval(tick, 1000);
    const timeout = setTimeout(() => {
      const entry = timeEntries.find(e => e.id === overtimeAlert.entryId);
      acknowledgedOvertimeRef.current[overtimeAlert.entryId] = Math.floor((entry?.dureeSeconds || 0) / OVERTIME_THRESHOLD_SECONDS);
      updateTimeEntryApi(overtimeAlert.entryId, { statut: 'PAUSED' });
      setOvertimeAlert(null);
      showToast('Tâche mise en pause automatiquement — aucune réponse à l’alerte de 2h.');
    }, Math.max(0, overtimeAlert.deadline - Date.now()));
    return () => { clearInterval(countdown); clearTimeout(timeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overtimeAlert]);

  const acknowledgeOvertimeAlert = () => {
    if (!overtimeAlert) return;
    const entry = timeEntries.find(e => e.id === overtimeAlert.entryId);
    acknowledgedOvertimeRef.current[overtimeAlert.entryId] = Math.floor((entry?.dureeSeconds || 0) / OVERTIME_THRESHOLD_SECONDS);
    setOvertimeAlert(null);
  };

  const pauseFromOvertimeAlert = () => {
    if (!overtimeAlert) return;
    const entry = timeEntries.find(e => e.id === overtimeAlert.entryId);
    acknowledgedOvertimeRef.current[overtimeAlert.entryId] = Math.floor((entry?.dureeSeconds || 0) / OVERTIME_THRESHOLD_SECONDS);
    updateTimeEntryApi(overtimeAlert.entryId, { statut: 'PAUSED' });
    setOvertimeAlert(null);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const updateTimeEntryApi = async (id: string, updates: Partial<TimeEntry>) => {
    // Apply locally first so PAUSE / ARRÊTER stop the on-screen chronometer
    // immediately, even if the SSE stream is momentarily down.
    setTimeEntries(prev => prev.map(e => (e.id === id ? { ...e, ...updates } : e)));
    try {
      const res = await fetch(`/api/time-entries/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setTimeEntries(prev => prev.map(e => (e.id === id ? decorate({ ...e, ...saved }) : e)));
    } catch (e) {
      console.error(e);
      // Roll back to whatever the server actually holds.
      showToast("Échec de l'enregistrement, resynchronisation…");
      fetchTimeEntries();
    }
  }

  // Derive activeTimer from timeEntries
  const myRunningEntry = timeEntries.find(e => e.userId === user?.id && e.statut === 'RUNNING');
  const myPausedEntries = timeEntries.filter(e => e.userId === user?.id && e.statut === 'PAUSED');
  
  const activeTimer: ActiveTimerState = myRunningEntry ? {
    id: myRunningEntry.id,
    client: myRunningEntry.client,
    clientId: myRunningEntry.clientId,
    task: myRunningEntry.description,
    pole: myRunningEntry.pole,
    taskType: myRunningEntry.taskType,
    serviceId: myRunningEntry.serviceId,
    startTime: myRunningEntry.heureDebut,
    elapsedSeconds: myRunningEntry.dureeSeconds,
    isRunning: myRunningEntry.statut === 'RUNNING',
    costRatePerHour: myRunningEntry.hourlyRate ?? null,
  } : {
    client: '-',
    task: '-',
    pole: '-',
    startTime: '00:00:00',
    elapsedSeconds: 0,
    isRunning: false,
    costRatePerHour: null,
  };

  const handleStopTimer = () => {
    if (myRunningEntry) {
      if (!confirm('Voulez-vous vraiment arrêter cette tâche ? Le temps déjà enregistré sera conservé.')) return;
      // heureFin is stamped server-side when the task actually completes.
      updateTimeEntryApi(myRunningEntry.id, { statut: 'COMPLETED' });
      showToast('Chronomètre arrêté et enregistré.');
    }
  };

  const handleResumeTimer = () => {
    if (myRunningEntry) {
      updateTimeEntryApi(myRunningEntry.id, { statut: 'RUNNING' });
      showToast('Chronomètre démarré.');
    }
  };

  const handlePauseTimer = () => {
    if (myRunningEntry) {
      setJustPausedId(myRunningEntry.id);
      updateTimeEntryApi(myRunningEntry.id, { statut: 'PAUSED' });
      showToast('Chronomètre en pause.');
    }
  };

  /**
   * The floating chronometer follows the running task; with none running it
   * falls back to one paused *in this session*, so pausing from it doesn't
   * make it vanish and strand the user with no way to resume without walking
   * back to Pointage. Deliberately not "the most recent paused entry": that
   * would park a task paused days ago in the corner of every page forever.
   */
  const floatingEntry =
    myRunningEntry || (justPausedId ? myPausedEntries.find(e => e.id === justPausedId) : undefined);

  const handleFloatingPause = () => {
    if (!floatingEntry) return;
    setJustPausedId(floatingEntry.id);
    updateTimeEntryApi(floatingEntry.id, { statut: 'PAUSED' });
    showToast('Chronomètre en pause.');
  };

  const handleFloatingResume = () => {
    if (!floatingEntry) return;
    setJustPausedId(null);
    updateTimeEntryApi(floatingEntry.id, { statut: 'RUNNING' });
    showToast('Chronomètre repris.');
  };

  const handleFloatingStop = () => {
    if (!floatingEntry) return;
    if (!confirm('Voulez-vous vraiment arrêter cette tâche ? Le temps déjà enregistré sera conservé.')) return;
    setJustPausedId(null);
    updateTimeEntryApi(floatingEntry.id, { statut: 'COMPLETED' });
    showToast('Chronomètre arrêté et enregistré.');
  };

  /* ---- The chronometer once the app is no longer on screen ---- */

  // Kept in refs so the service-worker message listener below can stay
  // subscribed once instead of tearing down and re-adding itself on every
  // tick of the entries list.
  const timeEntriesRef = useRef(timeEntries);
  timeEntriesRef.current = timeEntries;
  const justPausedIdRef = useRef(justPausedId);
  justPausedIdRef.current = justPausedId;

  // The tab title carries the clock, so switching to another tab still
  // answers "is it running, and for how long" from the tab strip alone.
  // Only while RUNNING: a paused task is not a clock, and leaving a frozen
  // time in the title reads as a stuck page.
  useEffect(() => {
    const base = 'Tâches & Cash';
    document.title =
      floatingEntry && floatingEntry.statut === 'RUNNING'
        ? `⏱ ${formatHHMMSS(floatingEntry.dureeSeconds)} · ${floatingEntry.client} — ${base}`
        : base;
  }, [floatingEntry?.statut, floatingEntry?.dureeSeconds, floatingEntry?.client]);

  useEffect(() => () => { document.title = 'Tâches & Cash'; }, []);

  /**
   * Read by the interval below rather than depending on the entry directly:
   * `dureeSeconds` changes every second, and an effect keyed on it would
   * redraw the OS notification once a second instead of once every 30s.
   */
  const timerNotifRef = useRef<{ elapsed: string; client: string; subtitle: string; running: boolean } | null>(null);
  timerNotifRef.current = floatingEntry
    ? {
        elapsed: formatHHMMSS(floatingEntry.dureeSeconds),
        client: floatingEntry.client,
        subtitle: [floatingEntry.pole, floatingEntry.taskType].filter(v => v && v !== '-').join(' · '),
        running: floatingEntry.statut === 'RUNNING',
      }
    : null;

  const [pageHidden, setPageHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const onVisibility = () => setPageHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Ongoing notification, shown only while the app is off screen — on screen
  // the floating card already says all of this, and a permanent OS toast
  // over it would just be noise. Keyed on id/statut (not the seconds) so a
  // state change redraws it at once while the clock refreshes on the timer.
  useEffect(() => {
    if (!pageHidden || !floatingEntry) {
      closeTimerNotification();
      return;
    }
    const push = () => {
      const snapshot = timerNotifRef.current;
      if (snapshot) showTimerNotification(snapshot);
    };
    push();
    const interval = setInterval(push, 30000);
    return () => clearInterval(interval);
  }, [pageHidden, floatingEntry?.id, floatingEntry?.statut]);

  useEffect(() => () => { closeTimerNotification(); }, []);

  // `requireInteraction` keeps the notification up until something takes it
  // down — including after the tab is gone, where React cleanup does not
  // reliably run. Left behind it would show a frozen time above buttons the
  // (now dead) page can no longer apply, so drop it as the page goes away.
  useEffect(() => {
    const onPageHide = () => closeTimerNotification();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Pause / Reprendre / Arrêter pressed on that notification. The worker
  // can't call the API itself (no access to the token), so it posts the
  // action here. No confirm() on stop: the tap on "Arrêter" *is* the
  // confirmation, and a dialog on a hidden page would never be seen.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'timer-action') return;
      const entry = timeEntriesRef.current.find(
        e => e.userId === user?.id && (e.statut === 'RUNNING' || e.id === justPausedIdRef.current),
      );
      if (!entry) return;
      if (event.data.action === 'pause') {
        setJustPausedId(entry.id);
        updateTimeEntryApi(entry.id, { statut: 'PAUSED' });
      } else if (event.data.action === 'resume') {
        setJustPausedId(null);
        updateTimeEntryApi(entry.id, { statut: 'RUNNING' });
      } else if (event.data.action === 'stop') {
        setJustPausedId(null);
        updateTimeEntryApi(entry.id, { statut: 'COMPLETED' });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [user?.id]);

  const handleStartNewTask = async (
    client: string,
    service: string,
    description: string,
    clientId?: number,
    serviceId?: number,
    taskType?: string,
    taskTypeId?: number
  ) => {
    if (myRunningEntry) {
      await updateTimeEntryApi(myRunningEntry.id, {
        statut: myRunningEntry.statut === 'RUNNING' ? 'COMPLETED' : myRunningEntry.statut
      });
    }

    const newId = `row-${Date.now()}`;

    // date / heureDebut are stamped server-side (single clock, single format),
    // and heureFin stays empty until the task is actually completed.
    const newEntry = {
      id: newId,
      client: client,
      clientId: clientId,
      description: description,
      pole: service,
      serviceId: serviceId,
      taskType: taskType,
      taskTypeId: taskTypeId,
      duree: '0h 0m 0s',
      dureeSeconds: 0,
      coutCalcule: '0,000 DT',
      statut: 'RUNNING',
    };

    try {
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newEntry)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      // The SSE broadcast can beat this response, so merge instead of prepending
      // blindly — otherwise the entry lands twice and React sees duplicate keys.
      setTimeEntries(prev => prev.some(e => e.id === saved.id)
        ? prev.map(e => (e.id === saved.id ? decorate({ ...e, ...saved }) : e))
        : [decorate({ ...saved, userName: user?.username }), ...prev]);
      showToast(`Nouvelle tâche démarrée : ${client}`);
    } catch (e) {
      console.error(e);
      showToast('Impossible de démarrer la tâche.');
      fetchTimeEntries();
    }
  };

  const handleDeleteEntry = async (id: string) => {
    const entry = timeEntries.find(e => e.id === id);
    const label = entry ? ` « ${entry.description || entry.taskType || entry.pole || entry.client} »` : '';
    if (!confirm(`Êtes-vous sûr de supprimer la tâche${label} ? Cette action est irréversible.`)) return;
    setTimeEntries(prev => prev.filter(e => e.id !== id));
    try {
      const res = await fetch(`/api/time-entries/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Activité supprimée avec succès.');
    } catch (e) {
      console.error(e);
      showToast('Échec de la suppression, resynchronisation…');
      fetchTimeEntries();
    }
  };

  const handleSaveEdit = async (updated: TimeEntry) => {
    await updateTimeEntryApi(updated.id, updated);
    showToast('Activité mise à jour.');
  };

  // Admin acting on someone else's task: set the status directly, without
  // touching the admin's own running timer.
  const handleAdminChangeStatus = async (entry: TimeEntry, statut: TimeEntry['statut']) => {
    if (statut === 'COMPLETED' && !confirm(`Voulez-vous vraiment arrêter cette tâche de ${entry.userName || 'ce collaborateur'} ? Le temps déjà enregistré sera conservé.`)) return;
    await updateTimeEntryApi(entry.id, { statut });
    const label = statut === 'PAUSED' ? 'mise en pause' : statut === 'RUNNING' ? 'reprise' : 'clôturée';
    showToast(`Tâche de ${entry.userName || 'collaborateur'} ${label}.`);
  };

  const handleSelectAsActive = async (entry: TimeEntry) => {
    if (myRunningEntry && myRunningEntry.id !== entry.id) {
      await updateTimeEntryApi(myRunningEntry.id, {
        statut: myRunningEntry.statut === 'RUNNING' ? 'COMPLETED' : myRunningEntry.statut
      });
    }
    await updateTimeEntryApi(entry.id, { statut: 'RUNNING' });
    showToast(`Chronomètre actif basculé sur "${entry.description}"`);
  };

  if (resetToken) {
    return (
      <ResetPassword
        token={resetToken}
        onDone={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setResetToken(null);
        }}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!user || !token) {
    return publicScreen === 'login'
      ? <Login onBack={() => setPublicScreen('landing')} />
      : <Landing onLogin={() => setPublicScreen('login')} />;
  }

  return (
    // h-screen, not min-h-screen: the shell must have a *definite* height for
    // the content column's own overflow-y-auto to become the single scroll
    // container. With min-h-screen the column just grew past the viewport, so
    // a page that pins its own footer (the Clients pagination bar) had that
    // footer pushed off-screen and reachable only by scrolling the whole page.
    <div className="h-screen bg-canvas text-gray-900 flex font-sans antialiased selection:bg-slate-800 selection:text-white">
      <Sidebar
        activeItem={activeSidebarItem}
        onSelectItem={(item) => setActiveSidebarItem(item)}
        unreadMessages={unreadMessages}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <Header
          userCode="ABA01"
          userName="Alexandre Dupont"
          onNavigate={setActiveSidebarItem}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
        />
        
        
        {activeSidebarItem === 'Plateforme' && user?.isPlatformAdmin ? (
          <PlatformAdmin />
        ) : activeSidebarItem === 'Dashboard' ? (
          // ADMIN/SUPERVISEUR get the team-wide dashboard; everyone else
          // (COLLABORATOR, STAGIAIRE) gets their own personal KPIs.
          (hasPermission('ADMIN') || DASHBOARD_ROLES.includes(user?.role ?? '')) ? <AdminDashboard /> : <MyDashboard />
        ) : activeSidebarItem === 'Messages' ? (
          <ChatPage onUnreadChange={setUnreadMessages} />
        ) : activeSidebarItem === 'Users' && hasPermission('MANAGE_USERS') ? (

          <UsersManagement />
        ) : activeSidebarItem === 'Clients' ? (
          <ClientsManagement />
        ) : activeSidebarItem === 'Missions' && hasPermission('MANAGE_SERVICES') ? (
          <MissionsManagement />
        ) : activeSidebarItem === 'Ressources' && hasPermission('VIEW_RESOURCES') ? (
          <ResourcesManagement />
        ) : activeSidebarItem === 'Cash' && hasPermission('VIEW_CASH') ? (
          <CashManagement />
        ) : activeSidebarItem === 'HR' && hasPermission('VIEW_HR') ? (
          <HRManagement />
        ) : activeSidebarItem === 'Time Tracking' ? (
          <main className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1400px] w-full mx-auto">
            
            
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <h1 className="text-[19px] font-extrabold text-gray-800 tracking-tight">
                  Team Time Tracking
                </h1>
                <p className="text-[11.5px] text-gray-500 mt-0.5">
                  Suivi du temps de travail et coût calculé des collaborateurs en temps réel
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  onClick={() => setIsPlanTaskOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                  Planifier une tâche
                </button>
                {hasPermission('ASSIGN_TASKS') && (
                  <button
                    onClick={() => setIsAssignTaskOpen(true)}
                    className="flex items-center gap-2 px-3.5 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Assigner une tâche
                  </button>
                )}
              </div>
            </div>

            {/* Two columns: the activity on the left, and on the right a panel
                that always answers "what are you on right now" — the running
                timer when there is one, the start form when there isn't. */}
            <div className="flex flex-col lg:flex-row lg:items-start gap-5">
              <div className="flex-1 min-w-0 flex flex-col gap-5">
                {/* Paused tasks stay visible while another task runs: they are
                    exactly what you might switch back to. */}
                {hasPermission('VIEW') && myPausedEntries.length > 0 && (
                  <PausedTasksList 
                    entries={myPausedEntries}
                    onResume={handleSelectAsActive}
                  />
                )}

              </div>

              <div className="flex-1 min-w-0 lg:sticky lg:top-6">
                {hasPermission('VIEW') && myRunningEntry ? (
                  <ActiveTimerCard
                    timerState={activeTimer}
                    onStart={handleResumeTimer}
                    onPause={handlePauseTimer}
                    onStop={handleStopTimer}
                  />
                ) : hasPermission('EDIT') && (
                  <NewTaskCard
                    services={servicesList}
                    taskTypes={taskTypesList}
                    onStartNewTask={handleStartNewTask}
                    refreshServices={() => {
                      if (token) {
                        fetch('/api/services', { headers: { 'Authorization': `Bearer ${token}` } })
                          .then(res => res.json())
                          .then(data => {
                            if (Array.isArray(data)) setServicesList(data);
                          }).catch(console.error);
                        fetch('/api/task-types', { headers: { 'Authorization': `Bearer ${token}` } })
                          .then(res => res.json())
                          .then(data => {
                            if (Array.isArray(data)) setTaskTypesList(data);
                          }).catch(console.error);
                      }
                    }}
                  />
                )}
              </div>
            </div>

            {hasPermission('VIEW') && (
              <TimeTrackingTable
                hasRunningTask={!!myRunningEntry}
                entries={timeEntries}
                onEdit={(entry) => setEditingEntry(entry)}
                onDelete={handleDeleteEntry}
                onMore={(entry) => showToast(`Options pour ${entry.client}`)}
                onSelectAsActive={handleSelectAsActive}
                onChangeStatus={user?.role === 'ADMIN' ? handleAdminChangeStatus : undefined}
                totalEntries={totalEntries ?? undefined}
              />
            )}
          </main>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Cette section ({activeSidebarItem}) est en cours de développement.
          </div>
        )}
      </div>

      {/* Mounted outside the page switch above so the clock and its controls
          survive navigation — the whole point of it. */}
      {hasPermission('VIEW') && floatingEntry && (
        <FloatingTimer
          entry={floatingEntry}
          onResume={handleFloatingResume}
          onPause={handleFloatingPause}
          onStop={handleFloatingStop}
        />
      )}

      <EditTaskModal
        entry={editingEntry}
        isOpen={Boolean(editingEntry)}
        onClose={() => setEditingEntry(null)}
        onSave={handleSaveEdit}
        taskTypes={taskTypesList}
      />

      {isAssignTaskOpen && (
        <AssignTaskModal
          services={servicesList}
          taskTypes={taskTypesList}
          onClose={() => setIsAssignTaskOpen(false)}
          onAssigned={() => showToast('Tâche assignée.')}
        />
      )}

      {isPlanTaskOpen && (
        <PlanTaskModal
          services={servicesList}
          taskTypes={taskTypesList}
          onClose={() => setIsPlanTaskOpen(false)}
          onPlanned={() => showToast('Tâche planifiée.')}
        />
      )}

      {overtimeAlert && (() => {
        const entry = timeEntries.find(e => e.id === overtimeAlert.entryId);
        const hours = entry ? Math.floor(entry.dureeSeconds / OVERTIME_THRESHOLD_SECONDS) * 2 : 2;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
              <h3 className="text-[15px] font-bold text-gray-900 mb-1">Toujours sur cette tâche ?</h3>
              <p className="text-[13px] text-gray-600 mb-3">
                Vous travaillez sur <span className="font-semibold">{entry?.pole || 'cette tâche'}</span>
                {entry?.client ? <> ({entry.client})</> : null} depuis plus de {hours}h sans interruption.
              </p>
              <p className="text-[12px] text-gray-400 mb-4">
                Sans réponse, la tâche sera mise en pause automatiquement dans {overtimeSecondsLeft}s.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={pauseFromOvertimeAlert}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50"
                >
                  Mettre en pause
                </button>
                <button
                  onClick={acknowledgeOvertimeAlert}
                  className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover"
                >
                  Oui, je continue
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {toastMessage && (
        <div className="fixed bottom-5 right-5 bg-navy text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xl z-50 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
