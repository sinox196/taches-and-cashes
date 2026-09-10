import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Timer, CalendarClock, ClipboardCheck, Play, Loader, X, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { friendlyError } from '../utils/errors';
import { SearchableSelect, type SearchableOption } from './SearchableSelect';
import { usePeriodPage, PaginationBar } from './PeriodPager';

const DELEGATED_PAGE_SIZE = 15;

const PRIORITY_STYLE: Record<string, string> = {
  BASSE: 'bg-gray-100 text-gray-500',
  NORMALE: 'bg-blue-50 text-blue-600',
  HAUTE: 'bg-orange-50 text-orange-600',
  URGENTE: 'bg-red-50 text-red-600',
};
const PRIORITY_LABEL: Record<string, string> = { BASSE: 'Basse', NORMALE: 'Normale', HAUTE: 'Haute', URGENTE: 'Urgente' };

/** Le statut d'une tâche déléguée avant démarrage est celui de l'assignation
 * (PENDING) ; une fois démarrée c'est celui, vivant, de l'entrée de pointage
 * qu'elle a fait naître — voir GET /api/task-assignments/delegated. */
const DELEGATED_STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-500',
  RUNNING: 'bg-run-bg text-run-fg',
  PAUSED: 'bg-pause-bg text-pause-fg',
  COMPLETED: 'bg-done-bg text-done-fg',
};
const DELEGATED_STATUS_LABEL: Record<string, string> = {
  PENDING: 'En attente', RUNNING: 'En cours', PAUSED: 'En pause', COMPLETED: 'Terminée',
};

type Tab = 'chrono' | 'planned' | 'assigned' | 'delegatedByMe';

/**
 * Les trois sous-vues de **Tâches** : le chrono, les tâches qu'on s'est
 * planifiées, celles qu'on vous a assignées.
 *
 * Les deux dernières vivaient dans une carte du tableau de bord
 * (`AssignedTasksCard`), qui mélangeait les deux et disparaissait dès qu'il
 * n'y avait rien en attente. Elles sont ici parce que c'est ici qu'on les
 * démarre : la tâche lancée devient une entrée de pointage, c'est-à-dire
 * l'onglet d'à côté — plus la traversée « tableau de bord → Tâches » qu'il
 * fallait faire à chaque fois.
 *
 * **Une seule liste au serveur, deux sous-vues à l'écran.**
 * `/api/task-assignments/mine` rend tout ce qui vous est assigné et en
 * attente ; ce qui les sépare est le `assignedByUserId` — vous, ou quelqu'un
 * d'autre. C'est exactement la distinction que l'ancienne carte imprimait
 * ligne par ligne (« Planifiée par vous » / « Assignée par X »), rendue en
 * deux onglets plutôt qu'en deux mentions à lire.
 *
 * Un seul chargement pour les deux : les compteurs des onglets doivent être
 * justes avant qu'on clique dessus, sinon rien ne signale la tâche qui
 * attend.
 *
 * C'est aussi ce chargement qui déclenche les **rappels** (la route les
 * transforme paresseusement en notification, faute de balayage périodique
 * dans cette app). Il part donc à l'ouverture de Tâches, quel que soit
 * l'onglet — pas seulement quand on regarde la liste.
 */
export const TaskSubviews: React.FC<{
  /** La vue chrono elle-même : rendue telle quelle sous l'onglet « Mon chrono ». */
  children: React.ReactNode;
  /** Une tâche vient de démarrer : le pointage a une entrée de plus à aller chercher. */
  onStarted?: () => void;
}> = ({ children, onStarted }) => {
  const { token, user, hasPermission } = useAuth();
  const canDelegate = hasPermission('ASSIGN_TASKS');
  // Clicking a "tâche déléguée"/"rappel de tâche planifiée" notification
  // wants a specific sub-tab open, not just this page — NotificationBell.tsx
  // stashes it here since Time Tracking carries no sub-tab of its own to read
  // it from (no router — see App.tsx). Consumed once, same idiom as the
  // `?nav=` query param a closed-app push leaves for App.tsx's own initial
  // `activeSidebarItem`.
  const [tab, setTab] = useState<Tab>(() => {
    const pending = sessionStorage.getItem('open_task_subview');
    if (pending) sessionStorage.removeItem('open_task_subview');
    return pending === 'planned' || pending === 'assigned' || pending === 'delegatedByMe' ? pending : 'chrono';
  });
  const [items, setItems] = useState<any[]>([]);
  const [delegated, setDelegated] = useState<any[]>([]);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    fetch('/api/task-assignments/mine', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : []))
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Ce que vous avez délégué à quelqu'un d'autre — invisible partout
    // ailleurs, puisque `/mine` ne répond qu'à « qu'est-ce qui m'est
    // assigné ». Réservé à qui peut déléguer : sans ASSIGN_TASKS la liste
    // serait toujours vide.
    if (canDelegate) {
      fetch('/api/task-assignments/delegated', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => (res.ok ? res.json() : []))
        .then(data => setDelegated(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [token, canDelegate]);

  // Planifier/déléguer une tâche se fait depuis les boutons de l'en-tête,
  // au-dessus de cette sous-vue mais hors d'elle (App.tsx monte les modales
  // au niveau de la page, pas ici) — la création n'a donc aucun moyen
  // d'appeler `load()` directement. Le même événement que
  // `refresh-hr-balance` comble ça : PlanTaskModal/AssignTaskModal le
  // déclenchent à la création, et cette liste se remet à jour sans attendre
  // qu'on quitte puis revienne sur l'onglet — ou qu'on recharge la page.
  useEffect(() => {
    load();
    window.addEventListener('refresh-task-assignments', load);
    return () => window.removeEventListener('refresh-task-assignments', load);
  }, [load]);

  // Same signal as the `sessionStorage` read above, for when this component
  // is already mounted (Time Tracking already open) when the notification is
  // clicked — the initial-state read only fires on mount, so a live update
  // needs the event too.
  useEffect(() => {
    const onOpenTab = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === 'chrono' || detail === 'planned' || detail === 'assigned' || detail === 'delegatedByMe') {
        setTab(detail);
      }
    };
    window.addEventListener('open-task-subview', onOpenTab);
    return () => window.removeEventListener('open-task-subview', onOpenTab);
  }, []);

  const planned = items.filter(a => a.assignedByUserId === user?.id);
  const assigned = items.filter(a => a.assignedByUserId !== user?.id);

  const start = async (id: string) => {
    setError('');
    setStartingId(id);
    try {
      const res = await fetch(`/api/task-assignments/${id}/start`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Démarrage impossible.');
      setItems(prev => prev.filter(a => a.id !== id));
      // La tâche est devenue une entrée de pointage : on va la regarder
      // tourner plutôt que de laisser une liste vide sans explication.
      onStarted?.();
      setTab('chrono');
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setStartingId(null);
    }
  };

  const cancel = async (id: string) => {
    if (!confirm('Annuler cette tâche ?')) return;
    setError('');
    setCancelingId(id);
    try {
      const res = await fetch(`/api/task-assignments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Annulation impossible.');
      setItems(prev => prev.filter(a => a.id !== id));
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setCancelingId(null);
    }
  };

  const TABS: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'chrono', label: 'Mon chrono', icon: Timer },
    { id: 'planned', label: 'Mes tâches planifiées', icon: CalendarClock, count: planned.length },
    { id: 'assigned', label: 'Tâches déléguées', icon: ClipboardCheck, count: assigned.length },
    // Réservé à qui peut déléguer — sinon un onglet toujours vide n'apprend
    // rien à personne.
    ...(canDelegate ? [{ id: 'delegatedByMe' as Tab, label: 'Déléguées par moi', icon: Send, count: delegated.length }] : []),
  ];

  return (
    <div className="flex flex-col sm:flex-1 sm:min-h-0">
      {/* Défile latéralement plutôt que de passer à la ligne : trois libellés
          ne tiennent pas dans la largeur d'un téléphone, comme la barre des
          onglets RH et celle des Ressources métier. */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2.5 text-[13px] font-medium flex items-center gap-1.5 border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap ${
              tab === t.id ? 'border-navy text-navy' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {/* Le compteur ne s'affiche qu'à partir de 1 : un « 0 » permanent
                sur deux onglets sur trois n'apprend rien et fait du bruit. */}
            {!!t.count && (
              <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                tab === t.id ? 'bg-navy text-white' : 'bg-blue-50 text-blue-600'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-1 sm:min-h-0">
        {tab === 'chrono' ? children : tab === 'delegatedByMe' ? (
          <DelegatedByMeList rows={delegated} />
        ) : (
          <div className="flex flex-col gap-4">
            {error && (
              <div className="p-2.5 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                {error}
              </div>
            )}
            <AssignmentList
              rows={tab === 'planned' ? planned : assigned}
              kind={tab === 'planned' ? 'planned' : 'assigned'}
              startingId={startingId}
              cancelingId={cancelingId}
              onStart={start}
              onCancel={cancel}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const EMPTY: Record<'planned' | 'assigned', { title: string; hint: string }> = {
  planned: {
    title: 'Aucune tâche planifiée.',
    hint: "Utilisez « Planifier une tâche » ci-dessus pour vous en réserver une : elle vous attendra ici jusqu'à son démarrage.",
  },
  assigned: {
    title: 'Aucune tâche ne vous est assignée.',
    hint: "Les tâches qu'un administrateur vous délègue apparaissent ici, en attente de démarrage.",
  },
};

const AssignmentList: React.FC<{
  rows: any[];
  kind: 'planned' | 'assigned';
  startingId: string | null;
  cancelingId: string | null;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
}> = ({ rows, kind, startingId, cancelingId, onStart, onCancel }) => {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-10 text-center">
        <p className="text-[13px] font-medium text-gray-600">{EMPTY[kind].title}</p>
        <p className="text-[12px] text-gray-400 mt-1 max-w-[46ch] mx-auto leading-relaxed">{EMPTY[kind].hint}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-4 sm:p-5">
      <p className="text-[11.5px] text-gray-500 mb-3">
        En attente de démarrage — une fois lancée, la tâche rejoint votre chrono.
      </p>
      <div className="divide-y divide-gray-100">
        {rows.map(a => (
          <div key={a.id} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13.5px] font-semibold text-gray-900">{a.pole}</span>
                {a.taskType && (
                  <span className="text-[10.5px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{a.taskType}</span>
                )}
                {a.priority && a.priority !== 'NORMALE' && (
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${PRIORITY_STYLE[a.priority] || PRIORITY_STYLE.NORMALE}`}>
                    {PRIORITY_LABEL[a.priority] || a.priority}
                  </span>
                )}
              </div>
              {a.client && <div className="text-[12px] text-gray-500 mt-0.5">{a.client}</div>}
              {a.description && (
                <div className="text-[12px] text-gray-400 italic mt-0.5" title={a.description}>{a.description}</div>
              )}
              <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-400 mt-1">
                {a.scheduledDate && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" />
                    {new Date(a.scheduledDate).toLocaleDateString('fr-FR')}
                  </span>
                )}
                {/* Qui l'a demandée : évident sur l'onglet « planifiées »
                    (c'est vous), pas sur l'autre. */}
                {kind === 'assigned' && <span>Déléguée par {a.assignedByName}</span>}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1.5 self-start">
              <button
                onClick={() => onStart(a.id)}
                disabled={startingId === a.id}
                className="px-3 py-1.5 bg-navy text-white rounded-lg text-[11.5px] font-bold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-1.5"
              >
                {startingId === a.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                Démarrer
              </button>
              <button
                onClick={() => onCancel(a.id)}
                disabled={cancelingId === a.id}
                title="Annuler cette tâche"
                className="w-7 h-7 border border-gray-200 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50"
              >
                {cancelingId === a.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Ce que vous avez délégué à quelqu'un d'autre — en lecture seule : ni
 * démarrer ni annuler ne vous appartient une fois que la tâche est partie
 * chez son assignataire, à qui l'onglet « Tâches déléguées » sert exactement
 * ces deux boutons. Ce qui est demandé ici est le statut, la mission, le
 * client, le type de tâche et la description ; le nom de l'assignataire
 * s'ajoute par nécessité — une liste de délégations sans dire à qui n'aide
 * personne.
 *
 * **Quatre filtres cherchables** (collaborateur, mission, type de tâche,
 * statut), même idiome que l'Historique de Ressources métier : chacun est un
 * `SearchableSelect` plutôt qu'un `<select>` natif ou un champ de recherche à
 * part — taper la première lettre suggère, cliquer sélectionne — avec une
 * option « Tous… » en tête qui remet le filtre à zéro. Les options sont
 * dérivées des lignes déjà reçues, jamais un second appel réseau.
 *
 * **Paginée à 15 lignes**, via `usePeriodPage`/`PaginationBar` de
 * [PeriodPager.tsx](PeriodPager.tsx) — réutilisé pour sa seule pagination
 * (l'année/le mois qu'il sait aussi filtrer ne sont pas rendus ici, rien n'a
 * demandé ce filtre-là sur cette liste). La barre reste **toujours visible**,
 * même sur une page unique, même règle que le Brouillard de caisse et les
 * onglets RH : une barre qui apparaît et disparaît fait sauter la liste.
 *
 * **La liste défile dans son propre cadre, la barre ne défile jamais hors
 * champ.** Un premier jet laissait la carte grandir avec son contenu et
 * comptait sur le défilement de la page pour atteindre « Suivant » — sur 15
 * lignes ça marchait, mais c'est exactement le piège `sticky bottom-0` que
 * les onglets RH documentent déjà : la barre était bien toujours rendue,
 * jamais toujours *visible*. La chaîne `sm:flex-1 sm:min-h-0` remonte
 * jusqu'à `TaskSubviews` et jusqu'au `<main>` de la page Tâches dans
 * App.tsx, pour que ce soit le cadre `overflow-auto` interne qui défile —
 * pas la colonne de contenu de l'application.
 */
const DelegatedByMeList: React.FC<{ rows: any[] }> = ({ rows }) => {
  const [userFilter, setUserFilter] = useState('');
  const [missionFilter, setMissionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const withAllOption = (label: string, values: (string | undefined)[]): SearchableOption[] => [
    { id: '', label },
    ...Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b)).map(v => ({ id: v, label: v })),
  ];
  const userOptions = useMemo(() => withAllOption('Tous les collaborateurs', rows.map(r => r.assignedToName)), [rows]);
  const missionOptions = useMemo(() => withAllOption('Toutes les missions', rows.map(r => r.pole)), [rows]);
  const typeOptions = useMemo(() => withAllOption('Tous les types de tâche', rows.map(r => r.taskType)), [rows]);
  const statusOptions = useMemo(() => [
    { id: '', label: 'Tous les statuts' },
    ...Array.from(new Set<string>(rows.map(r => r.status).filter(Boolean)))
      .map(s => ({ id: s, label: DELEGATED_STATUS_LABEL[s] || s })),
  ], [rows]);

  const filtered = useMemo(
    () => rows.filter(a =>
      (!userFilter || a.assignedToName === userFilter)
      && (!missionFilter || a.pole === missionFilter)
      && (!typeFilter || a.taskType === typeFilter)
      && (!statusFilter || a.status === statusFilter)),
    [rows, userFilter, missionFilter, typeFilter, statusFilter],
  );

  const pager = usePeriodPage<any>(filtered, a => a.createdAt, DELEGATED_PAGE_SIZE);

  const setUserFilterAndReset = (v: string) => { setUserFilter(v); pager.setPage(1); };
  const setMissionFilterAndReset = (v: string) => { setMissionFilter(v); pager.setPage(1); };
  const setTypeFilterAndReset = (v: string) => { setTypeFilter(v); pager.setPage(1); };
  const setStatusFilterAndReset = (v: string) => { setStatusFilter(v); pager.setPage(1); };

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-10 text-center">
        <p className="text-[13px] font-medium text-gray-600">Vous n'avez délégué aucune tâche.</p>
        <p className="text-[12px] text-gray-400 mt-1 max-w-[46ch] mx-auto leading-relaxed">
          Utilisez « Déléguer une tâche » ci-dessus. Vous verrez ici son statut, du démarrage à sa fin.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden flex flex-col sm:flex-1 sm:min-h-0">
      <div className="p-4 flex flex-col sm:flex-1 sm:min-h-0">
        <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0">
          <div className="w-48">
            <SearchableSelect value={userFilter} onChange={setUserFilterAndReset} options={userOptions} placeholder="Tous les collaborateurs" size="sm" />
          </div>
          <div className="w-44">
            <SearchableSelect value={missionFilter} onChange={setMissionFilterAndReset} options={missionOptions} placeholder="Toutes les missions" size="sm" />
          </div>
          <div className="w-52">
            <SearchableSelect value={typeFilter} onChange={setTypeFilterAndReset} options={typeOptions} placeholder="Tous les types de tâche" size="sm" />
          </div>
          <div className="w-44">
            <SearchableSelect value={statusFilter} onChange={setStatusFilterAndReset} options={statusOptions} placeholder="Tous les statuts" size="sm" />
          </div>
        </div>
        {/* Défile dans son propre cadre plutôt que d'étirer la carte : c'est
            ce qui laisse la barre de pagination ci-dessous atteignable sans
            faire défiler toute la page — même piège que documenté pour les
            onglets RH et le Brouillard de caisse. */}
        <div className="overflow-auto flex-1 min-h-0 sm:min-h-[260px]">
          {filtered.length === 0 ? (
            <p className="text-[12.5px] text-gray-400 italic text-center py-6">Aucune tâche ne correspond à ces filtres.</p>
          ) : (
          <div className="divide-y divide-gray-100">
            {pager.pageRows.map(a => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-semibold text-gray-900">{a.pole}</span>
                    {a.taskType && (
                      <span className="text-[10.5px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{a.taskType}</span>
                    )}
                    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${DELEGATED_STATUS_STYLE[a.status] || DELEGATED_STATUS_STYLE.PENDING}`}>
                      {DELEGATED_STATUS_LABEL[a.status] || a.status}
                    </span>
                  </div>
                  {a.client && <div className="text-[12px] text-gray-500 mt-0.5">{a.client}</div>}
                  {a.description && (
                    <div className="text-[12px] text-gray-400 italic mt-0.5" title={a.description}>{a.description}</div>
                  )}
                  <div className="text-[11px] text-gray-400 mt-1">Assignée à {a.assignedToName}</div>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
        {/* Toujours visible, même sur une seule page — même règle que le
            Brouillard de caisse et les onglets RH. */}
        <PaginationBar page={pager} unit="tâches déléguées" />
      </div>
    </div>
  );
};
