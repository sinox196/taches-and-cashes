import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Loader2, Filter, Calendar } from 'lucide-react';
import { KPICards } from './KPICards';
import { EmployeeTable } from './EmployeeTable';
import { EmployeeDetailsModal } from './EmployeeDetailsModal';
import { EmployeeTasksModal } from './EmployeeTasksModal';
import { ClientBreakdown } from './ClientBreakdown';
import { MultiSelectAutocomplete } from './MultiSelectAutocomplete';
import { ExecutiveBar } from './ExecutiveBar';
import { AlertsPanel } from './AlertsPanel';
import { ClientProfitability } from './ClientProfitability';
import { ConcentrationCard } from './ConcentrationCard';
import { TaskIntelligence } from './TaskIntelligence';

/**
 * Un cran au-dessus des en-têtes de carte (« RENTABILITÉ DU PORTEFEUILLE »,
 * « MISSIONS & TYPES DE TÂCHE »…) : ceux-là nomment une carte, ceci nomme un
 * groupe de plusieurs cartes qui répondent ensemble à une seule question. Le
 * titre est la question elle-même — pas un intitulé de module — pour que
 * l'écran se lise comme une suite de réponses plutôt que comme une liste de
 * fonctionnalités.
 */
const SectionHeading: React.FC<{ eyebrow: string; title: string; subtitle: string }> = ({ eyebrow, title, subtitle }) => (
  <div className="pt-2 first:pt-0">
    <div className="flex items-center gap-2.5">
      <span className="text-[10.5px] font-extrabold text-turquoise uppercase tracking-[0.08em] shrink-0">{eyebrow}</span>
      <span className="flex-1 h-px bg-gray-200" aria-hidden />
    </div>
    <h2 className="mt-1 text-[16px] font-extrabold text-navy tracking-tight">{title}</h2>
    <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>
  </div>
);

export const AdminDashboard: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  /** Agrégats du tableau de bord Direction — marge, alertes, rentabilité. */
  const [exec, setExec] = useState<any>(null);

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
    setYearFilter('');
  };

  // Même raccourci, d'un cran au-dessus : une année entière en un clic. Il
  // écrit dans les mêmes startDate/endDate que le reste, donc choisir un mois
  // ou toucher une date le désélectionne — il ne cherche pas à refléter une
  // plage quelconque, pas plus que le filtre par mois.
  const [yearFilter, setYearFilter] = useState('');
  const yearOptions = React.useMemo(() => {
    const current = new Date().getFullYear();
    // Cinq ans en arrière : au-delà, la plage libre Du/Au reste là pour aller
    // chercher un exercice ancien sans allonger la liste pour tout le monde.
    return Array.from({ length: 6 }, (_, i) => current - i);
  }, []);
  const applyYearFilter = (value: string) => {
    setYearFilter(value);
    if (!value) return;
    const year = Number(value);
    const first = new Date(year, 0, 1);
    // Plafonné à aujourd'hui, comme le filtre par mois : une fin d'année à
    // venir n'est qu'une plage vide.
    const last = new Date(year, 11, 31);
    const today = new Date();
    const end = last > today ? today : last;
    setMonthFilter('');
    setStartDate(toLocalDateString(first));
    setEndDate(toLocalDateString(end));
  };

  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [tasksEmployee, setTasksEmployee] = useState<any>(null);
  // Set when the tasks drill-down is opened from one client's row inside
  // EmployeeDetailsModal, so that view opens already narrowed to it instead
  // of showing every client again. Cleared on the plain "Nbr Clients"/
  // "Temps passé" entry points, which mean "show everything".
  const [tasksModalInitialSearch, setTasksModalInitialSearch] = useState('');
  /** Client à déplier dans « Activité par client », demandé depuis un autre bloc. */
  const [focusClient, setFocusClient] = useState<{ key: string; name: string; nonce: number } | null>(null);
  const focusOnClient = (key: string, name: string) => {
    setFocusClient({ key, name, nonce: Date.now() });
    document.getElementById('dashboard-activite-client')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };



  useEffect(() => {
    fetchKPIs();
  }, [startDate, endDate, selectedUsers, selectedClients, token]);

  const fetchKPIs = async () => {
    setLoading(true);

    const body = JSON.stringify({
      startDate,
      endDate,
      filterUserIds: selectedUsers.map(u => u.id),
      filterClientIds: selectedClients.map(c => c.id)
    });
    const post = (url: string) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
    });

    try {
      // Deux points d'entrée, un seul jeu de filtres : l'ancien résumé KPI et
      // les agrégats Direction. En parallèle — ils ne dépendent pas l'un de
      // l'autre, et l'un qui échoue ne doit pas emporter l'autre.
      const [kpiRes, execRes] = await Promise.allSettled([
        post('/api/kpi/dashboard'),
        post('/api/dashboard/executive'),
      ]);
      if (kpiRes.status === 'fulfilled' && kpiRes.value.ok) setStats(await kpiRes.value.json());
      if (execRes.status === 'fulfilled' && execRes.value.ok) setExec(await execRes.value.json());
      else setExec(null);
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

  /**
   * `/api/dashboard/executive` calcule déjà capacité/occupation par
   * collaborateur (c'est ce que lisent les alertes A7/A8), mais
   * `/api/kpi/dashboard` — qui alimente EmployeeTable — ne les porte pas.
   * Fusionné ici plutôt que dupliqué côté serveur : les deux routes gardent
   * leur périmètre propre, et le tableau affiche enfin ce que l'alerte
   * « Ahmed — 91 % d'occupation » explique déjà en haut de l'écran.
   * `exec.collaborateurs` ne porte pas la ligne ADMIN (voir `employees` dans
   * la route) — celle de `employeeStats` reste sans capacité/occupation, ce
   * qui se lit correctement comme « — ».
   */
  const execByUserId = new Map<number, any>((exec?.collaborateurs || []).map((c: any) => [c.userId, c]));
  const employeesWithCapacity = (stats?.employeeStats || []).map((e: any) => {
    const c = execByUserId.get(e.id);
    return c ? { ...e, capacite: c.capacite, occupation: c.occupation, heuresPrev: c.heuresPrev } : e;
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-canvas">
      <main className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">Tableau de bord</h1>
            <p className="text-[13px] text-gray-500 mt-1">Pilotage global de l'activité, des temps et du portefeuille client.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Du and Au each wrap as a unit: side by side they are wider than
                a phone, and the second date input used to run off the edge
                with no way to scroll to it. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white px-3 py-1.5 rounded-lg border border-gray-200 w-full sm:w-auto">
              <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] text-gray-500 font-medium">Du</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setMonthFilter(''); setYearFilter(''); }}
                  className="text-[13px] outline-none text-gray-700 bg-transparent min-w-0"
                />
              </div>
              <span className="text-gray-300 mx-1 hidden sm:inline">|</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] text-gray-500 font-medium">Au</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); setMonthFilter(''); setYearFilter(''); }}
                  className="text-[13px] outline-none text-gray-700 bg-transparent min-w-0"
                />
              </div>
            </div>

            <select
              value={monthFilter}
              onChange={e => applyMonthFilter(e.target.value)}
              title="Filtrer par mois"
              className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] text-gray-700 focus:outline-none cursor-pointer w-full sm:w-auto"
            >
              <option value="">Filtrer par mois…</option>
              {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <select
              value={yearFilter}
              onChange={e => applyYearFilter(e.target.value)}
              title="Filtrer par année"
              className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] text-gray-700 focus:outline-none cursor-pointer w-full sm:w-auto"
            >
              <option value="">Filtrer par année…</option>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
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

        {/* Quatre groupes, lus dans cet ordre comme une histoire : comment va
            l'entreprise, où est l'argent, où part le temps, qui fait quoi.
            Chaque groupe répond à sa propre question et ne se mélange pas
            avec le suivant — c'est ce qui rend le tout lisible d'un coup
            d'œil plutôt qu'en balayant une pile de cartes indifférenciées. */}
        {exec && (
          <>
            <SectionHeading
              eyebrow="01 · Vue d'ensemble"
              title="Comment va l'entreprise ?"
              subtitle="Le bandeau exécutif, puis ce qui demande une décision — la synthèse en dix secondes."
            />
            <ExecutiveBar
              data={exec.executive}
              financialsFiltered={exec.financialsFiltered}
              onAlertsClick={() => document.getElementById('dashboard-alertes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              onClientsClick={() => document.getElementById('dashboard-rentabilite')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />

            <div id="dashboard-alertes" className="scroll-mt-4">
              <AlertsPanel
                alerts={exec.alerts}
                total={exec.alertsTotal}
                onOpen={a => {
                  // On descend vers l'entité concernée plutôt que d'ouvrir une
                  // fenêtre de plus : le contexte de filtre reste visible.
                  if (a.entity === 'client') {
                    const row = exec.clients?.find((c: any) => c.clientId === a.entityId);
                    if (row) focusOnClient(row.key, row.name);
                    else document.getElementById('dashboard-rentabilite')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  } else if (a.entity === 'user' && a.entityId != null) {
                    const emp = stats?.employeeStats?.find((e: any) => e.id === a.entityId);
                    if (emp) setSelectedEmployee(emp);
                  }
                }}
              />
            </div>

            {exec.clients && (
              <>
                <SectionHeading
                  eyebrow="02 · Rentabilité"
                  title="Où est l'argent ?"
                  subtitle="Le rendement de chaque client, et le poids des plus gros dans le portefeuille."
                />
                <div id="dashboard-rentabilite" className="scroll-mt-4">
                  <ClientProfitability
                    clients={exec.clients}
                    onOpenClient={(key, name) => focusOnClient(key, name)}
                  />
                </div>
                {exec.concentration && <ConcentrationCard data={exec.concentration} />}
              </>
            )}

            {exec.missions && exec.missions.length > 0 && (
              <>
                <SectionHeading
                  eyebrow="03 · Opérations"
                  title="Où part le temps ?"
                  subtitle="Répartition du temps consommé par mission, puis par type de tâche."
                />
                <TaskIntelligence missions={exec.missions} />
              </>
            )}
          </>
        )}

        {stats && (
          <>
            <SectionHeading
              eyebrow="04 · Clients & équipe"
              title="Qui fait quoi ?"
              subtitle="L'activité détaillée client par client, puis la charge et la performance de chaque collaborateur."
            />
            <KPICards stats={stats.globalStats} />
            <div id="dashboard-activite-client" className="scroll-mt-4" />
            <ClientBreakdown
              clients={stats.clientStats}
              focusClient={focusClient}
              filters={{
                startDate,
                endDate,
                filterUserIds: selectedUsers.map(u => u.id),
                filterClientIds: selectedClients.map(c => c.id),
              }}
            />
            <EmployeeTable
              employees={employeesWithCapacity}
              onRowClick={setSelectedEmployee}
              onClientsClick={emp => { setTasksModalInitialSearch(''); setTasksEmployee(emp); }}
            />
          </>
        )}
      </main>
      
      {selectedEmployee && (
        <EmployeeDetailsModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          onViewClientTasks={clientName => {
            // One drill-down modal at a time — same invariant the table's own
            // entry points already keep.
            setSelectedEmployee(null);
            setTasksModalInitialSearch(clientName);
            setTasksEmployee(selectedEmployee);
          }}
        />
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
          initialSearch={tasksModalInitialSearch}
        />
      )}
    </div>
  );
};
