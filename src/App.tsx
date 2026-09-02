import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ActiveTimerCard } from './components/ActiveTimerCard';
import { FloatingTimer } from './components/FloatingTimer';
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
import { ReferralPage } from './components/ReferralPage';
import { ClientsManagement } from './components/clients/ClientsManagement';
import { HRManagement } from './components/hr/HRManagement';
import { TaskSubviews } from './components/TaskSubviews';
import { MissionsManagement } from './components/missions/MissionsManagement';
import { CashManagement } from './components/cash/CashManagement';
import { ResourcesManagement } from './components/resources/ResourcesManagement';
import { useEscapeToClose } from './hooks/useEscapeToClose';
import { closeLingeringTimerNotification } from './utils/osNotifications';
import { useAuth } from './context/AuthContext';
import { DASHBOARD_ROLES, CLIENT_ROLE } from './constants/roles';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { PlatformAdmin } from './pages/PlatformAdmin';
import { ClientPortal } from './pages/ClientPortal';
import { ResetPassword } from './pages/ResetPassword';
import { Loader2, ClipboardCheck, CalendarClock, LogIn, Pause, Square, X } from 'lucide-react';

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
  const NAV_IDS = ['Dashboard', 'Clients', 'Time Tracking', 'Messages', 'Missions', 'Ressources', 'Cash', 'HR', 'Users', 'Parrainage', 'Plateforme'];
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

  // Pointage gate: the very first thing shown once a shift is configured and
  // today's arrival hasn't been checked in yet — before any task can start,
  // not just on the HR page. Polled (not just fetched once) so a tab left
  // open across a shift boundary — or a day rollover — still catches it.
  const [attendanceGate, setAttendanceGate] = useState<{ shiftStart: string; shiftEnd: string; toleranceMinutes: number } | null>(null);
  const [attendanceGateBusy, setAttendanceGateBusy] = useState(false);
  const [attendanceGateError, setAttendanceGateError] = useState('');
  // Dismissable (X / Escape) rather than a hard block — closing it only
  // hides it until the next poll, which re-opens it as a reminder if the
  // arrival still hasn't been checked in.
  const [attendanceGateDismissed, setAttendanceGateDismissed] = useState(false);

  useEffect(() => {
    if (!token || !hasPermission('VIEW_HR')) return;
    const checkGate = () => {
      fetch('/api/attendance/today', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data?.shiftStart && !data.record?.checkinAt) {
            setAttendanceGate({ shiftStart: data.shiftStart, shiftEnd: data.shiftEnd, toleranceMinutes: data.toleranceMinutes });
            setAttendanceGateDismissed(false);
          } else {
            setAttendanceGate(null);
          }
        })
        .catch(() => {});
    };
    checkGate();
    const interval = setInterval(checkGate, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleGateCheckin = async () => {
    setAttendanceGateBusy(true);
    setAttendanceGateError('');
    try {
      const res = await fetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setAttendanceGate(null);
      } else {
        setAttendanceGateError(data.error || "Échec du pointage d'arrivée.");
      }
    } catch {
      setAttendanceGateError('Erreur de connexion.');
    } finally {
      setAttendanceGateBusy(false);
    }
  };

  useEscapeToClose(() => setAttendanceGateDismissed(true), !!attendanceGate && !attendanceGateDismissed);

  // Les effets ci-dessous appartiennent au back-office. Un `return` anticipé
  // dans le rendu ne les empêche PAS de tourner — les hooks s'exécutent avant
  // lui, quelle que soit la branche rendue — et ils partaient donc pour un
  // compte client, qui se voyait refuser chacun en 403. Ils sont donc gardés
  // ici, à la source.
  const isClientUser = user?.role === CLIENT_ROLE;

  useEffect(() => {
    if (token && !isClientUser) {
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
  }, [token, activeSidebarItem, isClientUser]);

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
    if (!token || isClientUser || activeSidebarItem !== 'Time Tracking') return;

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
  }, [token, isClientUser, activeSidebarItem, fetchTimeEntries]);

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

  // Overtime alert: ask the collaborator whether they're still on a task
  // every 2h *of that task's own duration* — at 2h, then 4h, 6h, … Responding
  // keeps it running; ignoring it for the grace period below pauses it.
  //
  // The milestone already asked about is recorded **on the entry itself**
  // (`overtimeAckCycle`), not in the browser. That is what makes "every 2h"
  // mean what it says:
  //  - it survives a reload, so opening the app does not re-ask (it was held
  //    in a `useRef` once, which died on every remount and re-fired the popup
  //    on every single page load);
  //  - it follows the task rather than the device, so answering on a phone
  //    doesn't leave a laptop asking again about the same 2h;
  //  - and it is tied to the duration, not to wall-clock time, so a prompt
  //    lands when the work actually crosses 4h — not merely because two
  //    hours have gone by since the last one.
  const OVERTIME_THRESHOLD_SECONDS = 2 * 3600;
  const OVERTIME_GRACE_MS = 2 * 60 * 1000;
  const [overtimeAlert, setOvertimeAlert] = useState<{ entryId: string; deadline: number } | null>(null);
  const [overtimeSecondsLeft, setOvertimeSecondsLeft] = useState(0);

  /** Which 2h milestone a duration has reached: 0 under 2h, 1 at 2h, 2 at 4h… */
  const overtimeCycleOf = (seconds: number) =>
    Math.floor((seconds || 0) / OVERTIME_THRESHOLD_SECONDS);

  useEffect(() => {
    const myRunning = timeEntries.find(e => e.userId === user?.id && e.statut === 'RUNNING');
    if (!myRunning) { setOvertimeAlert(null); return; }
    if (overtimeAlert) return;

    const cycle = overtimeCycleOf(myRunning.dureeSeconds);
    if (cycle < 1) return;
    if (cycle <= (myRunning.overtimeAckCycle || 0)) return;

    // Recorded when the popup is *shown*, not when it is answered, so a
    // reload while it is open doesn't bring it straight back. The write goes
    // through updateTimeEntryApi, which applies it to local state first —
    // otherwise this effect would re-fire on the next tick, before the
    // round-trip and broadcast land.
    updateTimeEntryApi(myRunning.id, { overtimeAckCycle: cycle });
    setOvertimeAlert({ entryId: myRunning.id, deadline: Date.now() + OVERTIME_GRACE_MS });
  }, [timeEntries, user?.id, overtimeAlert]);

  useEffect(() => {
    if (!overtimeAlert) return;
    const tick = () => setOvertimeSecondsLeft(Math.max(0, Math.ceil((overtimeAlert.deadline - Date.now()) / 1000)));
    tick();
    const countdown = setInterval(tick, 1000);
    const timeout = setTimeout(() => {
      updateTimeEntryApi(overtimeAlert.entryId, { statut: 'PAUSED' });
      setOvertimeAlert(null);
      showToast('Tâche mise en pause automatiquement — aucune réponse à l’alerte de 2h.');
    }, Math.max(0, overtimeAlert.deadline - Date.now()));
    return () => { clearInterval(countdown); clearTimeout(timeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overtimeAlert]);

  const acknowledgeOvertimeAlert = () => {
    if (!overtimeAlert) return;
    setOvertimeAlert(null);
  };

  const pauseFromOvertimeAlert = () => {
    if (!overtimeAlert) return;
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
  //
  // The tab title is the only carrier left. The ongoing OS notification with
  // Pause / Arrêter — both the one drawn here while the tab was hidden and
  // the one the server pushed once the browser was closed — was removed at
  // the user's request: they did not want the app putting a control surface
  // in front of them after they had left it. The floating card covers the
  // in-app case, and Pointage covers the rest.

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

  // Transitional: take down a chronometer notification left behind by an
  // older build. It was drawn with `requireInteraction`, so the OS keeps it
  // until something closes it, and nothing else does any more.
  useEffect(() => { closeLingeringTimerNotification(); }, []);

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

  /**
   * Reprendre une tâche alors qu'une autre tourne demandait une décision qui
   * n'était jamais posée : l'ancienne version *clôturait* la tâche en cours,
   * sans rien demander. Mettre en pause et arrêter ne sont pas la même chose —
   * une tâche arrêtée par erreur ne se reprend pas, il faut en recréer une.
   * On demande donc, plutôt que de choisir à la place de l'utilisateur.
   */
  const [switchPrompt, setSwitchPrompt] = useState<{ from: TimeEntry; to: TimeEntry } | null>(null);

  const startEntry = async (entry: TimeEntry) => {
    await updateTimeEntryApi(entry.id, { statut: 'RUNNING' });
    showToast(`Chronomètre basculé sur « ${entry.description || entry.taskType || entry.pole || entry.client} »`);
  };

  const handleSelectAsActive = async (entry: TimeEntry) => {
    if (myRunningEntry && myRunningEntry.id !== entry.id) {
      setSwitchPrompt({ from: myRunningEntry, to: entry });
      return;
    }
    await startEntry(entry);
  };

  /** Choix fait dans la fenêtre : que devient la tâche en cours ? */
  const resolveSwitch = async (action: 'PAUSED' | 'COMPLETED') => {
    if (!switchPrompt) return;
    const { from, to } = switchPrompt;
    setSwitchPrompt(null);
    if (action === 'PAUSED') setJustPausedId(from.id);
    await updateTimeEntryApi(from.id, { statut: action });
    await startEntry(to);
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

  // Un client passe par le même écran de connexion que les collaborateurs :
  // c'est ici, sur son rôle, qu'il bascule sur le portail au lieu du
  // back-office. Le branchement est **avant** toute la coquille interne — pas
  // une branche de plus dans la chaîne de `activeSidebarItem` — pour qu'aucun
  // effet ni aucun fetch du back-office (SSE du pointage, KPI, liste des
  // services…) ne parte pour un compte qui n'a le droit d'en lire aucun.
  if (user.role === CLIENT_ROLE) {
    return <ClientPortal />;
  }

  return (
    // A definite height, not min-h-screen: the shell must have one for the
    // content column's own overflow-y-auto to become the single scroll
    // container. With min-h-screen the column just grew past the viewport, so
    // a page that pins its own footer (the Clients pagination bar) had that
    // footer pushed off-screen and reachable only by scrolling the whole page.
    //
    // dvh rather than vh: on a phone `100vh` is the viewport with the browser
    // chrome *hidden*, so a pinned footer — the chat composer, the Clients
    // pagination bar — sat behind the address bar until you scrolled.
    <div className="h-dvh bg-canvas text-gray-900 flex font-sans antialiased selection:bg-slate-800 selection:text-white">
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
        ) : activeSidebarItem === 'Parrainage' && hasPermission('MANAGE_USERS') ? (
          <ReferralPage />
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
                  Mes tâches & chrono
                </h1>
                <p className="text-[11.5px] text-gray-500 mt-0.5">
                  Gérez votre chrono et vos tâches en cours
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
                    Déléguer une tâche
                  </button>
                )}
              </div>
            </div>

            {/* Trois sous-vues : le chrono, les tâches planifiées, les tâches
                assignées. Les deux dernières vivaient dans une carte du
                tableau de bord ; elles sont ici parce que c'est ici qu'on les
                démarre. L'en-tête et ses deux boutons restent au-dessus de la
                barre d'onglets : « Planifier une tâche » se clique aussi bien
                depuis la liste des tâches planifiées. */}
            <TaskSubviews onStarted={fetchTimeEntries}>
            <div className="flex flex-col gap-4 sm:gap-6">
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
                onSelectAsActive={handleSelectAsActive}
                onChangeStatus={user?.role === 'ADMIN' ? handleAdminChangeStatus : undefined}
                totalEntries={totalEntries ?? undefined}
              />
            )}
            </div>
            </TaskSubviews>
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
          raised={activeSidebarItem === 'Messages'}
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
          onAssigned={() => {
            showToast('Tâche assignée.');
            // TaskSubviews vit sous la vue Tâches, hors de cette modale montée
            // au niveau de la page — sans cet événement sa liste ne se
            // remettait à jour qu'au prochain montage, donc au rechargement
            // de la page.
            window.dispatchEvent(new Event('refresh-task-assignments'));
          }}
        />
      )}

      {isPlanTaskOpen && (
        <PlanTaskModal
          services={servicesList}
          taskTypes={taskTypesList}
          onClose={() => setIsPlanTaskOpen(false)}
          onPlanned={() => {
            showToast('Tâche planifiée.');
            window.dispatchEvent(new Event('refresh-task-assignments'));
          }}
        />
      )}

      {switchPrompt && (() => {
        const label = (e: TimeEntry) => e.description || e.taskType || e.pole || e.client;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h3 className="text-[15px] font-bold text-gray-900 mb-1">Une tâche est déjà en cours</h3>
              <p className="text-[13px] text-gray-600 mb-4">
                Vous êtes sur <span className="font-semibold">{label(switchPrompt.from)}</span>
                {switchPrompt.from.client ? <> ({switchPrompt.from.client})</> : null}.
                Pour reprendre <span className="font-semibold">{label(switchPrompt.to)}</span>, que faut-il en faire ?
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => resolveSwitch('PAUSED')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-navy text-white rounded-lg text-[13px] font-semibold hover:bg-navy-hover"
                >
                  <Pause className="w-4 h-4" /> Mettre en pause et basculer
                </button>
                <button
                  onClick={() => resolveSwitch('COMPLETED')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Square className="w-4 h-4" /> Arrêter et basculer
                </button>
                <button
                  onClick={() => setSwitchPrompt(null)}
                  className="w-full px-4 py-2 text-[12.5px] font-medium text-gray-500 hover:text-gray-700"
                >
                  Annuler — rester sur la tâche en cours
                </button>
              </div>
              <p className="text-[11.5px] text-gray-400 mt-3">
                Une tâche mise en pause se reprend quand vous voulez ; une tâche arrêtée est clôturée.
              </p>
            </div>
          </div>
        );
      })()}

      {overtimeAlert && (() => {
        const entry = timeEntries.find(e => e.id === overtimeAlert.entryId);
        const hours = entry ? Math.floor(entry.dureeSeconds / OVERTIME_THRESHOLD_SECONDS) * 2 : 2;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
              <h3 className="text-[15px] font-bold text-gray-900 mb-1">Toujours sur cette tâche ?</h3>
              <p className="text-[13px] text-gray-600 mb-3">
                Vous travaillez sur <span className="font-semibold">{entry?.pole || 'cette tâche'}</span>
                {entry?.client ? <> ({entry.client})</> : null} depuis plus de {hours}h cumulées.
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

      {/* Pointage gate — the first thing shown once a shift is configured and
          today's arrival isn't checked in yet. Above everything else
          (z-[100]). Dismissable via the X or Escape — it's a reminder, not a
          hard lock — but reappears on the next 5-minute poll as long as the
          arrival is still unchecked. */}
      {attendanceGate && !attendanceGateDismissed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <button
              onClick={() => setAttendanceGateDismissed(true)}
              aria-label="Fermer"
              className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <LogIn className="w-7 h-7 text-emerald-600" />
            </div>
            <h3 className="text-[16px] font-bold text-gray-900 mb-1">Pointez votre arrivée</h3>
            <p className="text-[13px] text-gray-600 mb-1">
              Votre shift commence à {attendanceGate.shiftStart}.
            </p>
            <p className="text-[12px] text-gray-400 mb-5">
              Pointez votre arrivée avant de commencer une tâche.
            </p>
            {attendanceGateError && (
              <p className="text-[12px] text-red-600 font-medium mb-3">{attendanceGateError}</p>
            )}
            <button
              onClick={handleGateCheckin}
              disabled={attendanceGateBusy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-[14px] font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <LogIn className="w-4 h-4" /> Pointer mon arrivée
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
