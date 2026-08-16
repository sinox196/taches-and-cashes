import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ActiveTimerCard } from './components/ActiveTimerCard';
import { NewTaskCard } from './components/NewTaskCard';
import { TimeTrackingTable } from './components/TimeTrackingTable';
import { PausedTasksList } from './components/PausedTasksList';
import { EditTaskModal } from './components/EditTaskModal';
import { AdminDashboard } from './components/dashboard/AdminDashboard';
import { UsersManagement } from './components/UsersManagement';
import { ClientsManagement } from './components/clients/ClientsManagement';
import { HRManagement } from './components/hr/HRManagement';
import { SettingsPage } from './components/Settings';
import { useAuth } from './context/AuthContext';
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
  
  const [activeSidebarItem, setActiveSidebarItem] = useState('Time Tracking');
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [servicesList, setServicesList] = useState<any[]>([]);

  useEffect(() => {
    if (token) {
      fetch('/api/clients', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setClientsList(data);
        }).catch(console.error);

      fetch('/api/services', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setServicesList(data);
        }).catch(console.error);
    }
  }, [token, activeSidebarItem]); 

  useEffect(() => {
    if (!token || activeSidebarItem !== 'Time Tracking') return;
    
    // Initial fetch to avoid SSE delay
    fetch('/api/time-entries', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const formatted = data.map((e: any) => ({
             ...e,
             duree: formatVerboseDuration(e.dureeSeconds || 0),
             coutCalcule: calculateCostDT(e.dureeSeconds || 0, e.hourlyRate || 5.812)
          }));
          setTimeEntries(formatted);
        }
      }).catch(console.error);

    const source = new EventSource(`/api/time-entries/stream?token=${token}`);
    
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
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
            return {
               ...serverEntry, 
               duree: formatVerboseDuration(serverEntry.dureeSeconds || 0),
               coutCalcule: calculateCostDT(serverEntry.dureeSeconds || 0, serverEntry.hourlyRate || 5.812)
            };
          });
        });
      } catch (e) {
        console.error('SSE Error:', e);
      }
    };
    source.onerror = (e) => {
      console.error('SSE Connection Error:', e);
      source.close();
      setTimeout(() => {
        // Try to reconnect? For now just let it be or it reconnects automatically
      }, 5000);
    }

    return () => {
      source.close();
    };
  }, [token, activeSidebarItem]);

  const [isNewTaskCardOpen, setIsNewTaskCardOpen] = useState<boolean>(true);
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
              coutCalcule: calculateCostDT(nextSecs, entry.hourlyRate || 5.812)
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
    try {
      await fetch(`/api/time-entries/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error(e);
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
    serviceId: myRunningEntry.serviceId,
    startTime: myRunningEntry.heureDebut,
    elapsedSeconds: myRunningEntry.dureeSeconds,
    isRunning: myRunningEntry.statut === 'RUNNING',
    costRatePerHour: myRunningEntry.hourlyRate || 5.812,
  } : {
    client: '-',
    task: '-',
    pole: '-',
    startTime: '00:00:00',
    elapsedSeconds: 0,
    isRunning: false,
    costRatePerHour: 5.812,
  };

  const handleStopTimer = () => {
    if (myRunningEntry) {
      updateTimeEntryApi(myRunningEntry.id, {
        statut: 'COMPLETED',
        heureFin: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      });
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

  const handleStartNewTask = async (client: string, service: string, description: string, clientId?: number, serviceId?: number) => {
    if (myRunningEntry) {
      await updateTimeEntryApi(myRunningEntry.id, {
        statut: myRunningEntry.statut === 'RUNNING' ? 'COMPLETED' : myRunningEntry.statut
      });
    }

    const newId = `row-${Date.now()}`;
    const todayStr = new Date().toLocaleDateString('fr-FR');
    const nowTimeStr = new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const newEntry = {
      id: newId,
      date: todayStr,
      client: client,
      clientId: clientId,
      description: description,
      pole: service,
      serviceId: serviceId,
      heureDebut: nowTimeStr,
      heureFin: nowTimeStr,
      duree: '0h 0m 0s',
      dureeSeconds: 0,
      coutCalcule: '0,000 DT',
      statut: 'RUNNING',
    };

    try {
      await fetch('/api/time-entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newEntry)
      });
      showToast(`Nouvelle tâche démarrée : ${client}`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await fetch(`/api/time-entries/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      showToast('Activité supprimée avec succès.');
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveEdit = async (updated: TimeEntry) => {
    await updateTimeEntryApi(updated.id, updated);
    showToast('Activité mise à jour.');
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
      <div className="min-h-screen flex items-center justify-center bg-[#F2F4F7]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!user || !token) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-[#F2F4F7] text-gray-900 flex font-sans antialiased selection:bg-slate-800 selection:text-white">
      <Sidebar
        activeItem={activeSidebarItem}
        onSelectItem={(item) => setActiveSidebarItem(item)}
      />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <Header userCode="ABA01" userName="Alexandre Dupont" />
        
        
        {activeSidebarItem === 'Dashboard' && (hasPermission('ADMIN') || user?.role === 'ADMIN' || user?.role === 'SUPERVISEUR') ? (
          <AdminDashboard />
        ) : activeSidebarItem === 'Users' && hasPermission('MANAGE_USERS') ? (

          <UsersManagement />
        ) : activeSidebarItem === 'Clients' ? (
          <ClientsManagement />
        ) : activeSidebarItem === 'HR' && hasPermission('VIEW_HR') ? (
          <HRManagement />
        ) : activeSidebarItem === 'Time Tracking' ? (
          <main className="p-6 lg:p-8 flex-1 flex flex-col space-y-6 max-w-[1400px] w-full mx-auto">
            
            
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="flex-1 w-full mr-0 md:mr-4">
                <div className="mb-6">
                  <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">
                    Team Time Tracking
                  </h1>
                  <p className="text-[12px] text-gray-500 mt-1">
                    Suivi du temps de travail et coût calculé des collaborateurs en temps réel
                  </p>
                </div>
                
                {hasPermission('VIEW') && !myRunningEntry && myPausedEntries.length > 0 && (
                  <PausedTasksList 
                    entries={myPausedEntries}
                    onResume={handleSelectAsActive}
                  />
                )}
              </div>

              <div className="md:w-80 shrink-0">
                {hasPermission('EDIT') && !myRunningEntry && (
                  <NewTaskCard
                    clients={clientsList.length > 0 ? clientsList : INITIAL_CLIENTS}
                    services={servicesList}
                    onStartNewTask={handleStartNewTask}
                    isOpen={isNewTaskCardOpen}
                    onToggleOpen={() => setIsNewTaskCardOpen((prev) => !prev)}
                    refreshServices={() => {
                      if (token) {
                        fetch('/api/services', { headers: { 'Authorization': `Bearer ${token}` } })
                          .then(res => res.json())
                          .then(data => {
                            if (Array.isArray(data)) setServicesList(data);
                          }).catch(console.error);
                      }
                    }}
                  />
                )}
              </div>
            </div>

            {hasPermission('VIEW') && myRunningEntry && (
              <ActiveTimerCard
                timerState={activeTimer}
                onStart={handleResumeTimer}
                onPause={handlePauseTimer}
                onStop={handleStopTimer}
              />
            )}
            


            {hasPermission('VIEW') && (
              <TimeTrackingTable
                   hasRunningTask={!!myRunningEntry}
                   entries={timeEntries}
                onEdit={(entry) => setEditingEntry(entry)}
                onDelete={handleDeleteEntry}
                onMore={(entry) => showToast(`Options pour ${entry.client}`)}
                onSelectAsActive={handleSelectAsActive}
              />
            )}
          </main>
        ) : activeSidebarItem === 'Settings' ? (
          <SettingsPage />
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
        <div className="fixed bottom-5 right-5 bg-[#101828] text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xl z-50 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
