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
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-[#F2F4F7]">
      <main className="p-6 lg:p-8 flex-1 flex flex-col space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">Tableau de bord</h1>
            <p className="text-[13px] text-gray-500 mt-1">Vue d'ensemble des performances opérationnelles et RH</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-[13px] text-gray-500 font-medium">Du</span>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)}
                className="text-[13px] outline-none text-gray-700 bg-transparent"
              />
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-[13px] text-gray-500 font-medium">Au</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                className="text-[13px] outline-none text-gray-700 bg-transparent"
              />
            </div>
            
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
