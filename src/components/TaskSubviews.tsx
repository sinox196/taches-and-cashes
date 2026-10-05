import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Timer, CalendarClock, ClipboardCheck, Play, Loader, X, Send, StickyNote, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { friendlyError } from '../utils/errors';
import { SearchableSelect, type SearchableOption } from './SearchableSelect';
import { usePeriodPage, PaginationBar } from './PeriodPager';
import { ClientSearchInput } from './cash/ClientSearchInput';
import { APP_TIMEZONE } from '../utils/formatters';

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

type Tab = 'notes' | 'chrono' | 'planned' | 'assigned' | 'delegatedByMe';

/**
 * Une couleur par sous-vue — les notes, le chrono, ce qu'on s'est planifié,
 * ce qu'on vous a délégué, ce que vous avez délégué à d'autres — reprise sur
 * l'onglet actif et sur la carte qu'il affiche, pour qu'un coup d'œil dise
 * sous quel onglet on se trouve sans avoir à relire son libellé.
 */
const TAB_COLOR: Record<Tab, { border: string; text: string; badgeActive: string; badgeIdle: string; cardBorder: string; caption: string }> = {
  notes:          { border: 'border-rose-600',    text: 'text-rose-700',    badgeActive: 'bg-rose-600 text-white',    badgeIdle: 'bg-rose-50 text-rose-600',     cardBorder: 'border-l-rose-400',    caption: 'text-rose-700' },
  chrono:         { border: 'border-sky-600',     text: 'text-sky-700',     badgeActive: 'bg-sky-600 text-white',     badgeIdle: 'bg-sky-50 text-sky-600',       cardBorder: 'border-l-sky-400',     caption: 'text-sky-700' },
  planned:        { border: 'border-amber-600',   text: 'text-amber-700',   badgeActive: 'bg-amber-600 text-white',   badgeIdle: 'bg-amber-50 text-amber-600',   cardBorder: 'border-l-amber-400',   caption: 'text-amber-700' },
  assigned:       { border: 'border-violet-600',  text: 'text-violet-700',  badgeActive: 'bg-violet-600 text-white',  badgeIdle: 'bg-violet-50 text-violet-600', cardBorder: 'border-l-violet-400',  caption: 'text-violet-700' },
  delegatedByMe:  { border: 'border-emerald-600', text: 'text-emerald-700', badgeActive: 'bg-emerald-600 text-white', badgeIdle: 'bg-emerald-50 text-emerald-600', cardBorder: 'border-l-emerald-400', caption: 'text-emerald-700' },
};

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
  /** Pour le formulaire d'ajout de note et son expansion « Démarrer ». */
  services?: any[];
  taskTypes?: any[];
  /** Bouton « Planifier »/« Déléguer » d'une ligne de note — ouvre la modale correspondante, déjà remplie. */
  onPlanNote?: (note: any) => void;
  onDelegateNote?: (note: any) => void;
}> = ({ children, onStarted, services = [], taskTypes = [], onPlanNote, onDelegateNote }) => {
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
    return pending === 'notes' || pending === 'planned' || pending === 'assigned' || pending === 'delegatedByMe' ? pending : 'chrono';
  });
  const [items, setItems] = useState<any[]>([]);
  const [delegated, setDelegated] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadNotes = useCallback(() => {
    if (!token) return;
    fetch('/api/task-notes', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : []))
      .then(data => setNotes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token]);

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
    loadNotes();
  }, [token, canDelegate, loadNotes]);

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

  // Une note convertie via « Planifier »/« Déléguer » (App.tsx, modales
  // montées au niveau de la page) est supprimée côté serveur puis annoncée
  // ici — cette liste vit dans ce composant, ces modales n'y ont aucun accès
  // direct. Même idiome que `refresh-task-assignments` juste au-dessus.
  useEffect(() => {
    window.addEventListener('refresh-task-notes', loadNotes);
    return () => window.removeEventListener('refresh-task-notes', loadNotes);
  }, [loadNotes]);

  // Same signal as the `sessionStorage` read above, for when this component
  // is already mounted (Time Tracking already open) when the notification is
  // clicked — the initial-state read only fires on mount, so a live update
  // needs the event too.
  useEffect(() => {
    const onOpenTab = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === 'notes' || detail === 'chrono' || detail === 'planned' || detail === 'assigned' || detail === 'delegatedByMe') {
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

  /**
   * Démarrer une note : exactement le même geste que « Démarrer » sur une
   * tâche déléguée (`start()` ci-dessus), plus loin dans la route — quand la
   * note n'a pas encore de mission, `client`/`pole`/`serviceId`/`taskType`/
   * `taskTypeId` viennent du mini-formulaire que `NotesList` a fait remplir
   * avant d'appeler ceci ; sinon ils sont `undefined` et la route relit ceux
   * déjà stockés sur la note.
   */
  const startNote = async (id: string, fields?: {
    client?: string; clientId?: number;
    pole?: string; serviceId?: string | number | null;
    taskType?: string; taskTypeId?: string | number | null;
  }) => {
    setError('');
    setStartingId(id);
    try {
      const res = await fetch(`/api/task-notes/${id}/start`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(fields || {}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Démarrage impossible.');
      setNotes(prev => prev.filter(n => n.id !== id));
      onStarted?.();
      setTab('chrono');
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setStartingId(null);
    }
  };

  const TABS: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'notes', label: 'Notes', icon: StickyNote, count: notes.length },
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
        {TABS.map(t => {
          const c = TAB_COLOR[t.id];
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2.5 text-[13px] font-medium flex items-center gap-1.5 border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap ${
                active ? `${c.border} ${c.text}` : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {/* Le compteur ne s'affiche qu'à partir de 1 : un « 0 » permanent
                  sur deux onglets sur trois n'apprend rien et fait du bruit. */}
              {!!t.count && (
                <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${active ? c.badgeActive : c.badgeIdle}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-1 sm:min-h-0">
        {tab === 'chrono' ? children : tab === 'notes' ? (
          <>
            {error && (
              <div className="mb-3 p-2.5 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                {error}
              </div>
            )}
            <NotesList
              notes={notes}
              services={services}
              taskTypes={taskTypes}
              color={TAB_COLOR.notes}
              token={token}
              startingId={startingId}
              onNoteAdded={n => setNotes(prev => [n, ...prev])}
              onNoteDeleted={id => setNotes(prev => prev.filter(n => n.id !== id))}
              onStart={startNote}
              onPlan={onPlanNote}
              onDelegate={onDelegateNote}
            />
          </>
        ) : tab === 'delegatedByMe' ? (
          <DelegatedByMeList rows={delegated} color={TAB_COLOR.delegatedByMe} />
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
              color={TAB_COLOR[tab === 'planned' ? 'planned' : 'assigned']}
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
  color: typeof TAB_COLOR[Tab];
  startingId: string | null;
  cancelingId: string | null;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
}> = ({ rows, kind, color, startingId, cancelingId, onStart, onCancel }) => {
  if (rows.length === 0) {
    return (
      <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${color.cardBorder} shadow-xs p-10 text-center`}>
        <p className="text-[13px] font-medium text-gray-600">{EMPTY[kind].title}</p>
        <p className="text-[12px] text-gray-400 mt-1 max-w-[46ch] mx-auto leading-relaxed">{EMPTY[kind].hint}</p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${color.cardBorder} shadow-xs p-4 sm:p-5`}>
      <p className={`text-[11.5px] font-medium mb-3 ${color.caption}`}>
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
const DelegatedByMeList: React.FC<{ rows: any[]; color: typeof TAB_COLOR[Tab] }> = ({ rows, color }) => {
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
      <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${color.cardBorder} shadow-xs p-10 text-center`}>
        <p className="text-[13px] font-medium text-gray-600">Vous n'avez délégué aucune tâche.</p>
        <p className="text-[12px] text-gray-400 mt-1 max-w-[46ch] mx-auto leading-relaxed">
          Utilisez « Déléguer une tâche » ci-dessus. Vous verrez ici son statut, du démarrage à sa fin.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${color.cardBorder} shadow-xs overflow-hidden flex flex-col sm:flex-1 sm:min-h-0`}>
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

/**
 * « Notes » — une zone de saisie rapide, avant même de savoir la mission.
 * Contrairement à « Planifier »/« Déléguer » (`task_assignments`, mission
 * requise), une note n'exige que la description : le client, la mission et
 * le type de tâche peuvent tous les trois attendre. Trois façons de la
 * convertir, chacune un bouton par ligne :
 *
 * - **Démarrer** — si la mission manque encore, une ligne s'ouvre en
 *   dessous pour la demander (avec le type de tâche, facultatif) avant de
 *   lancer réellement le chrono ; sinon la note démarre d'un clic. Dans les
 *   deux cas c'est `PUT /api/task-notes/:id/start`, qui crée l'entrée de
 *   pointage par le même chemin que « Démarrer nouvelle tâche » et supprime
 *   la note.
 * - **Planifier** / **Déléguer** — ouvrent directement la modale
 *   correspondante (App.tsx), déjà remplie avec ce que la note portait ; la
 *   note n'est supprimée qu'une fois cette modale effectivement soumise
 *   avec succès (voir `deleteSourceNoteIfAny` dans App.tsx), jamais avant.
 *
 * La note elle-même n'est donc jamais qu'une étape de transit — elle
 * disparaît dès qu'elle est devenue autre chose (une tâche en cours, une
 * planification, une délégation), ou sur suppression manuelle.
 */
const NotesList: React.FC<{
  notes: any[];
  services: any[];
  taskTypes: any[];
  color: typeof TAB_COLOR[Tab];
  token: string | null;
  startingId: string | null;
  onNoteAdded: (note: any) => void;
  onNoteDeleted: (id: string) => void;
  onStart: (id: string, fields?: { client?: string; clientId?: number; pole?: string; serviceId?: number; taskType?: string; taskTypeId?: number }) => void;
  onPlan?: (note: any) => void;
  onDelegate?: (note: any) => void;
}> = ({ notes, services, taskTypes, color, token, startingId, onNoteAdded, onNoteDeleted, onStart, onPlan, onDelegate }) => {
  // Formulaire d'ajout — description et client sont les deux seuls champs
  // réellement exigés pour enregistrer une note (donc toujours visibles) ;
  // mission et type de tâche restent derrière un chevron, puisqu'eux seuls
  // peuvent attendre.
  const [description, setDescription] = useState('');
  const [client, setClient] = useState('');
  const [clientId, setClientId] = useState<number | undefined>(undefined);
  const [serviceId, setServiceId] = useState('');
  const [taskTypeId, setTaskTypeId] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Ligne dont le bouton « Démarrer » a été cliqué sans mission déjà connue —
  // un mini-formulaire s'ouvre juste en dessous pour la demander. Le client
  // y est repris (modifiable, mais toujours exigé) : une note en porte déjà
  // un depuis sa création, mais le mini-formulaire permet de le corriger au
  // même moment plutôt que de rouvrir la note ensuite.
  const [startingRowId, setStartingRowId] = useState<string | null>(null);
  const [startClient, setStartClient] = useState('');
  const [startClientId, setStartClientId] = useState<number | undefined>(undefined);
  const [startServiceId, setStartServiceId] = useState('');
  const [startTaskTypeId, setStartTaskTypeId] = useState('');

  const taskTypesFor = (svcId: string) => (svcId ? taskTypes.filter(t => String(t.serviceId) === svcId) : []);

  const canAdd = !!description.trim() && !!client.trim();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd || !token) return;
    setAdding(true);
    setAddError('');
    try {
      const service = services.find(s => String(s.id) === serviceId);
      const taskType = taskTypes.find(t => String(t.id) === taskTypeId);
      const res = await fetch('/api/task-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          client: client || undefined,
          clientId,
          pole: service?.name,
          serviceId: service ? Number(service.id) : undefined,
          taskType: taskType?.name,
          taskTypeId: taskType ? Number(taskType.id) : undefined,
          description: description.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Impossible d'enregistrer la note.");
      onNoteAdded(body);
      setDescription('');
      setClient('');
      setClientId(undefined);
      setServiceId('');
      setTaskTypeId('');
      setDetailsOpen(false);
    } catch (err: any) {
      setAddError(friendlyError(err));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette note ?') || !token) return;
    try {
      await fetch(`/api/task-notes/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch { /* la liste locale se corrige quand même en dessous */ }
    onNoteDeleted(id);
  };

  const beginStart = (note: any) => {
    if (note.pole) { onStart(note.id); return; }
    setStartClient(note.client || '');
    setStartClientId(note.clientId ?? undefined);
    setStartServiceId('');
    setStartTaskTypeId('');
    setStartingRowId(note.id);
  };

  const confirmStart = (note: any) => {
    const service = services.find(s => String(s.id) === startServiceId);
    const taskType = taskTypes.find(t => String(t.id) === startTaskTypeId);
    onStart(note.id, {
      client: startClient || undefined,
      clientId: startClientId,
      pole: service?.name,
      serviceId: service ? Number(service.id) : undefined,
      taskType: taskType?.name,
      taskTypeId: taskType ? Number(taskType.id) : undefined,
    });
    setStartingRowId(null);
  };

  /** Date civile pure, fuseau du cabinet — même raisonnement que `formatTimeTN`. */
  const noteDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { timeZone: APP_TIMEZONE });
  };

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${color.cardBorder} shadow-xs overflow-hidden flex flex-col sm:flex-1 sm:min-h-0`}>
      <form onSubmit={handleAdd} className="p-4 border-b border-gray-100 shrink-0">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Notez une tâche à faire — mission et type de tâche peuvent attendre…"
            className="flex-1 bg-rose-50/60 border border-rose-200 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-rose-400"
          />
          <div className="w-full sm:w-56">
            <ClientSearchInput
              value={client}
              onChange={(name, id) => { setClient(name); setClientId(id); }}
              placeholder="Client"
              bgClassName="bg-rose-50/60"
            />
          </div>
          <button
            type="button"
            onClick={() => setDetailsOpen(o => !o)}
            className="px-3 py-2 border border-gray-200 rounded-md text-[12px] font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 shrink-0"
          >
            {detailsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Mission / type
          </button>
          <button
            type="submit"
            disabled={!canAdd || adding}
            className="px-4 py-2 bg-navy text-white rounded-md text-[12.5px] font-bold hover:bg-navy-hover disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
          >
            {adding ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Ajouter la note
          </button>
        </div>
        {detailsOpen && (
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            <SearchableSelect
              value={serviceId}
              onChange={id => { setServiceId(id); setTaskTypeId(''); }}
              options={services.map(s => ({ id: s.id, label: s.name }))}
              placeholder="Mission (facultatif)"
              size="sm"
              bgClassName="bg-rose-50/60"
            />
            <SearchableSelect
              value={taskTypeId}
              onChange={setTaskTypeId}
              options={taskTypesFor(serviceId).map(t => ({ id: t.id, label: t.name }))}
              placeholder="Type de tâche (facultatif)"
              size="sm"
              bgClassName="bg-rose-50/60"
            />
          </div>
        )}
        {addError && <p className="text-[11.5px] text-red-600 mt-1.5">{addError}</p>}
      </form>

      {notes.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-[13px] font-medium text-gray-600">Aucune note pour le moment.</p>
          <p className="text-[12px] text-gray-400 mt-1 max-w-[46ch] mx-auto leading-relaxed">
            Notez une idée de tâche même sans savoir encore la mission — vous la préciserez au moment de démarrer, planifier ou déléguer.
          </p>
        </div>
      ) : (
        <div className="overflow-auto flex-1 min-h-0 sm:min-h-[200px]">
          <table className="w-full text-[12.5px] border-collapse">
            <thead className="sticky top-0 bg-gray-50 text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left whitespace-nowrap">Date d'enregistrement</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Mission</th>
                <th className="px-3 py-2 text-left">Type de tâche</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {notes.map(note => (
                <React.Fragment key={note.id}>
                  <tr className="hover:bg-gray-50/60">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{noteDate(note.createdAt)}</td>
                    <td className="px-3 py-2 text-gray-700">{note.client || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{note.pole || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{note.taskType || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-600 italic max-w-[260px] break-words">
                      {note.description}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => beginStart(note)}
                          disabled={startingId === note.id}
                          className="px-2.5 py-1.5 bg-navy text-white rounded-lg text-[11px] font-bold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                        >
                          {startingId === note.id ? <Loader className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                          Démarrer
                        </button>
                        <button
                          onClick={() => onPlan?.(note)}
                          className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-[11px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap"
                        >
                          <CalendarClock className="w-3 h-3" />
                          Planifier
                        </button>
                        {onDelegate && (
                          <button
                            onClick={() => onDelegate?.(note)}
                            className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-[11px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap"
                          >
                            <ClipboardCheck className="w-3 h-3" />
                            Déléguer
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(note.id)}
                          title="Supprimer la note"
                          className="w-7 h-7 border border-gray-200 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:border-red-200 transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {startingRowId === note.id && (
                    <tr className="bg-rose-50/40">
                      <td colSpan={6} className="px-3 py-3">
                        <p className="text-[11.5px] font-medium text-gray-600 mb-2">
                          Client et mission requis pour démarrer — type de tâche facultatif :
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="w-full sm:w-52">
                            <ClientSearchInput
                              value={startClient}
                              onChange={(name, id) => { setStartClient(name); setStartClientId(id); }}
                              placeholder="Client"
                              bgClassName="bg-rose-50/60"
                            />
                          </div>
                          <div className="w-full sm:w-52">
                            <SearchableSelect
                              value={startServiceId}
                              onChange={id => { setStartServiceId(id); setStartTaskTypeId(''); }}
                              options={services.map(s => ({ id: s.id, label: s.name }))}
                              placeholder="Sélectionner une mission"
                              size="sm"
                              bgClassName="bg-rose-50/60"
                            />
                          </div>
                          <div className="w-full sm:w-52">
                            <SearchableSelect
                              value={startTaskTypeId}
                              onChange={setStartTaskTypeId}
                              options={taskTypesFor(startServiceId).map(t => ({ id: t.id, label: t.name }))}
                              placeholder="Type de tâche (facultatif)"
                              size="sm"
                              bgClassName="bg-rose-50/60"
                            />
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => confirmStart(note)}
                              disabled={!startServiceId || !startClient.trim()}
                              className="px-3 py-1.5 bg-navy text-white rounded-lg text-[11px] font-bold hover:bg-navy-hover disabled:opacity-50"
                            >
                              Démarrer
                            </button>
                            <button
                              onClick={() => setStartingRowId(null)}
                              className="px-3 py-1.5 border border-gray-300 rounded-lg text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
