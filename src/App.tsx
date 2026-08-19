import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ActiveTimerCard } from './components/ActiveTimerCard';
import { NewTaskCard } from './components/NewTaskCard';
import { TimeTrackingTable } from './components/TimeTrackingTable';
import { PausedTasksList } from './components/PausedTasksList';
import { EditTaskModal } from './components/EditTaskModal';
import { AdminDashboard } from './components/dashboard/AdminDashboard';
import { MyDashboard } from './components/dashboard/MyDashboard';
import { ChatPage } from './components/chat/ChatPage';
import { UsersManagement } from './components/UsersManagement';
import { ClientsManagement } from './components/clients/ClientsManagement';
import { HRManagement } from './components/hr/HRManagement';
import { MissionsManagement } from './components/missions/MissionsManagement';
import { CashManagement } from './components/cash/CashManagement';
import { useAuth } from './context/AuthContext';
import { DASHBOARD_ROLES } from './constants/roles';
import { Login } from './pages/Login';
import { Loader2 } from 'lucide-react';

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
  
  // Remember the current section so a refresh (or anything that remounts the
  // app) leaves you where you were instead of bouncing back to Pointage.
  const NAV_IDS = ['Dashboard', 'Clients', 'Time Tracking', 'Messages', 'Missions', 'Cash', 'HR', 'Reports', 'Users'];
  const [activeSidebarItem, setActiveSidebarItem] = useState(() => {
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

  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
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
      updateTimeEntryApi(myRunningEntry.id, { statut: 'PAUSED' });
      showToast('Chronomètre en pause.');
    }
  };

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!user || !token) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-canvas text-gray-900 flex font-sans antialiased selection:bg-slate-800 selection:text-white">
      <Sidebar
        activeItem={activeSidebarItem}
        onSelectItem={(item) => setActiveSidebarItem(item)}
        unreadMessages={unreadMessages}
      />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <Header userCode="ABA01" userName="Alexandre Dupont" />
        
        
        {activeSidebarItem === 'Dashboard' ? (
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
        ) : activeSidebarItem === 'Cash' && hasPermission('VIEW_CASH') ? (
          <CashManagement />
        ) : activeSidebarItem === 'HR' && hasPermission('VIEW_HR') ? (
          <HRManagement />
        ) : activeSidebarItem === 'Time Tracking' ? (
          <main className="p-6 lg:p-8 flex-1 flex flex-col space-y-6 max-w-[1400px] w-full mx-auto">
            
            
            <div>
              <h1 className="text-[19px] font-extrabold text-gray-800 tracking-tight">
                Team Time Tracking
              </h1>
              <p className="text-[11.5px] text-gray-500 mt-0.5">
                Suivi du temps de travail et coût calculé des collaborateurs en temps réel
              </p>
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

              <div className="lg:w-[320px] shrink-0 lg:sticky lg:top-6">
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

      <EditTaskModal
        entry={editingEntry}
        isOpen={Boolean(editingEntry)}
        onClose={() => setEditingEntry(null)}
        onSave={handleSaveEdit}
      />

      {toastMessage && (
        <div className="fixed bottom-5 right-5 bg-navy text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xl z-50 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
