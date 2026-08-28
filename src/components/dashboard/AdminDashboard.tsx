import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Loader2, Filter, Calendar } from 'lucide-react';
import { KPICards } from './KPICards';
import { EmployeeTable } from './EmployeeTable';
import { DashboardCharts } from './DashboardCharts';
import { EmployeeDetailsModal } from './EmployeeDetailsModal';
import { EmployeeTasksModal } from './EmployeeTasksModal';
import { ClientBreakdown } from './ClientBreakdown';
import { MultiSelectAutocomplete } from './MultiSelectAutocomplete';
import { AssignedTasksCard } from './AssignedTasksCard';
import { ResourcesProgressCard } from './ResourcesProgressCard';


export const AdminDashboard: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  // Filters
  const toLocalDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1); // First day of current month
    return toLocalDateString(d);
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return toLocalDateString(new Date()); // Today
  });
  const [selectedUsers, setSelectedUsers] = useState<{id: number, name: string}[]>([]);
  const [selectedClients, setSelectedClients] = useState<{id: number, name: string}[]>([]);

  // Quick "filtrer par mois" shortcut alongside the free Du/Au range below —
  // picking one narrows startDate/endDate to that calendar month in one
  // click instead of setting both dates by hand. Purely a shortcut: it
  // writes into the same startDate/endDate state the range inputs use, so
  // editing either input afterward silently falls out of sync with it,
  // exactly like the year/month `<select>`s elsewhere in the app (CashJournal,
  // ClientPayments) that don't try to reflect an arbitrary custom range either.
  const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const [monthFilter, setMonthFilter] = useState('');
  const monthOptions = React.useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = 0; i < 12; i++) {
      opts.push({ value: `${cursor.getFullYear()}-${cursor.getMonth()}`, label: `${MONTHS_FR[cursor.getMonth()]} ${cursor.getFullYear()}` });
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return opts;
  }, []);
  const applyMonthFilter = (value: string) => {
    setMonthFilter(value);
    if (!value) return;
    const [yearStr, monthStr] = value.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const first = new Date(year, month, 1);
    // Capped at today rather than the month's actual last day: a future
    // endDate would just be a range with nothing in it for the current month,
    // and there is never anything to find past today for an earlier one either.
    const last = new Date(year, month + 1, 0);
    const today = new Date();
    const end = last > today ? today : last;
    setStartDate(toLocalDateString(first));
    setEndDate(toLocalDateString(end));
  };

  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [tasksEmployee, setTasksEmployee] = useState<any>(null);



  useEffect(() => {
    fetchKPIs();
  }, [startDate, endDate, selectedUsers, selectedClients, token]);

  const fetchKPIs = async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/kpi/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          startDate,
          endDate,
          filterUserIds: selectedUsers.map(u => u.id),
          filterClientIds: selectedClients.map(c => c.id)
        })
      });
      if (res.ok) {
        setStats(await res.json());
      }
    } catch (error) {
      console.error('Failed to fetch KPIs', error);
    } finally {
      setLoading(false);
    }
  };

  if (!stats && loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-canvas">
      <main className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">Tableau de bord</h1>
            <p className="text-[13px] text-gray-500 mt-1">Pilotage global de l'activité, des temps et du portefeuille client.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-[13px] text-gray-500 font-medium">Du</span>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => { setStartDate(e.target.value); setMonthFilter(''); }}
                className="text-[13px] outline-none text-gray-700 bg-transparent"
              />
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-[13px] text-gray-500 font-medium">Au</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => { setEndDate(e.target.value); setMonthFilter(''); }}
                className="text-[13px] outline-none text-gray-700 bg-transparent"
              />
            </div>

            <select
              value={monthFilter}
              onChange={e => applyMonthFilter(e.target.value)}
              title="Filtrer par mois"
              className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] text-gray-700 focus:outline-none cursor-pointer"
            >
              <option value="">Filtrer par mois…</option>
              {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <MultiSelectAutocomplete 
              placeholder="Rechercher collaborateur..."
              endpoint="/api/kpi/users/search"
              selectedItems={selectedUsers}
              onChange={setSelectedUsers}
            />

            <MultiSelectAutocomplete 
              placeholder="Rechercher client..."
              endpoint="/api/kpi/clients/search"
              selectedItems={selectedClients}
              onChange={setSelectedClients}
            />
          </div>
        </div>

        {/* An ADMIN/SUPERVISEUR can themselves be assigned a task by another
            admin — this dashboard is their only one, so it needs the same
            widget MyDashboard shows a collaborator. */}
        <AssignedTasksCard />

        {/* Ressources métier — independent of the Pointage-driven stats below:
            no date range, no collaborateur/client filter, just current state. */}
        <ResourcesProgressCard selectedClients={selectedClients} />

        {stats && (
          <>
            <KPICards stats={stats.globalStats} />
            <ClientBreakdown
              clients={stats.clientStats}
              filters={{
                startDate,
                endDate,
                filterUserIds: selectedUsers.map(u => u.id),
                filterClientIds: selectedClients.map(c => c.id),
              }}
            />
            <DashboardCharts employees={stats.employeeStats} />
            <EmployeeTable
              employees={stats.employeeStats}
              onRowClick={setSelectedEmployee}
              onClientsClick={setTasksEmployee}
            />
          </>
        )}
      </main>
      
      {selectedEmployee && (
        <EmployeeDetailsModal employee={selectedEmployee} onClose={() => setSelectedEmployee(null)} />
      )}

      {tasksEmployee && (
        <EmployeeTasksModal
          employee={tasksEmployee}
          filters={{
            startDate,
            endDate,
            filterUserIds: selectedUsers.map(u => u.id),
            filterClientIds: selectedClients.map(c => c.id),
          }}
          onClose={() => setTasksEmployee(null)}
        />
      )}
    </div>
  );
};
