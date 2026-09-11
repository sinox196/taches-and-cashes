import React from 'react';
import { Logo } from './Logo';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Clock,
  Receipt,
  Users2,
  ChevronRight,
  X,
  Layers,
  Globe,
  MessageCircle,
  FileCheck2,
  Building2,
  Gift
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { planAllowsModule, type PlanModule } from '../constants/plans';
import { useLanguage } from '../context/LanguageContext';

interface SidebarProps {
  activeItem?: string;
  onSelectItem?: (item: string) => void;
  collapsed?: boolean;
  /** Unread chat messages, shown as a badge on the Messages nav item. */
  unreadMessages?: number;
  /** Mobile drawer state. Ignored from `lg` up, where the rail is always shown. */
  open?: boolean;
  onClose?: () => void;
}

type NavItem = { id: string; label: string; icon: any; hasChevron: boolean; badge?: number };

/** One nav rail button — extracted so the grouped list and the ungrouped Plateforme entry share the exact same markup. */
const NavButton: React.FC<{ item: NavItem; isActive: boolean; onSelect: () => void }> = ({ item, isActive, onSelect }) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-[9px] text-[12.5px] transition-all group ${
        isActive
          ? 'bg-white/10 text-white font-bold'
          : 'text-white/60 hover:text-white hover:bg-white/5 font-medium'
      }`}
    >
      <div className="flex items-center gap-2.5 truncate">
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </div>
      {!!item.badge && (
        <span className="ml-1 shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
      {item.hasChevron && (
        <ChevronRight className="w-3 h-3 shrink-0 opacity-80" />
      )}
    </button>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem = 'Time Tracking',
  onSelectItem,
  unreadMessages = 0,
  open = false,
  onClose,
}) => {
  const { hasPermission, user } = useAuth();
  const { t, language, setLanguage } = useLanguage();

  // Every authenticated user gets a "Dashboard" entry: DASHBOARD_ROLES see the
  // team-wide AdminDashboard, everyone else gets their own personal KPIs
  // (MyDashboard) — the routing decision lives in App.tsx.
  //
  // Grouped under three headers at the user's request — a section per
  // question ("piloter le travail" / "l'argent et l'équipe" / "le reste") —
  // rather than one flat list. The grouping is purely visual: each item's
  // `id` still routes through the same App.tsx branch and plan/permission
  // gate it always did, so adding a group header never risks re-threading
  // any of that.
  const NAV_GROUPS: { header: string; items: NavItem[] }[] = [
    {
      header: 'Pilotage & Production',
      items: [
        { id: 'Dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, hasChevron: false },
        ...(hasPermission('VIEW_CLIENTS') ? [{ id: 'Clients', label: t('nav.clients'), icon: Users, hasChevron: false }] : []),
        ...(hasPermission('MANAGE_SERVICES') ? [{ id: 'Missions', label: 'Missions', icon: Layers, hasChevron: false }] : []),
        { id: 'Time Tracking', label: t('nav.timeTracking'), icon: Clock, hasChevron: true },
      ],
    },
    {
      header: 'Finance & RH',
      items: [
        // Cash a trois sous-onglets, chacun sa propre permission désormais
        // (Facturation/Règlements clients/Brouillard de caisse) — l'entrée
        // de nav s'affiche dès qu'au moins l'un des trois est accordé,
        // sinon un titulaire de la seule permission Règlements clients
        // n'aurait aucun moyen d'atteindre l'écran qui la sert.
        ...(hasPermission('VIEW_CASH') || hasPermission('VIEW_CLIENT_PAYMENTS') || hasPermission('VIEW_CASH_JOURNAL')
          ? [{ id: 'Cash', label: 'Facturation & Trésorerie', icon: Receipt, hasChevron: false }] : []),
        // UserCheck, not Users2: Équipe took the plain "group of people" mark, and
        // two nav items sharing one icon is unreadable at 16px.
        ...(hasPermission('MANAGE_USERS') ? [{ id: 'Users', label: t('nav.users'), icon: Users2, hasChevron: false }] : []),
        // GRH & Paie fusionne RH et l'ex-page « Gestion des paies » sous un
        // seul lien — la Paie vit désormais dans un onglet de HRManagement,
        // donc l'un ou l'autre droit suffit à ouvrir ce lien (voir App.tsx et
        // HRManagement.tsx's canViewHr/canViewPayroll).
        ...((hasPermission('VIEW_HR') || hasPermission('VIEW_PAYROLL')) ? [{ id: 'HR', label: t('nav.hr'), icon: UserCheck, hasChevron: true }] : []),
      ],
    },
    {
      header: 'Outils & Collaboration',
      items: [
        ...(hasPermission('VIEW_RESOURCES') ? [{ id: 'Ressources', label: 'Outils de travail', icon: FileCheck2, hasChevron: false }] : []),
        { id: 'Messages', label: 'Messages', icon: MessageCircle, hasChevron: false, badge: unreadMessages },
        // Parrainage : chaque collaborateur a désormais son propre code, pas
        // seulement qui gère l'équipe — voir CLAUDE.md « Parrainage ». Le
        // filtre d'offre (module « Parrainage ») s'applique toujours plus
        // bas, indépendamment de cette permission qui n'en est plus une ici.
        { id: 'Parrainage', label: 'Parrainage', icon: Gift, hasChevron: false },
      ],
    },
  ];

  /**
   * Une offre restreinte ne dessine pas les entrées qu'elle ne vend pas.
   *
   * Les entrées gardées par une permission se ferment déjà d'elles-mêmes —
   * `hasPermission` consulte l'offre. Ce filtre-ci est pour les entrées qui
   * n'en portent aucune : **Tableau de bord, Tâches, Messages et
   * Parrainage** (ce dernier n'a plus besoin de `MANAGE_USERS` — voir
   * plus haut — mais reste fermé sur une offre qui ne vend pas ce module).
   * Un groupe qui perd tous ses éléments à ce filtre (une offre qui ne vend
   * aucun de ses modules) n'affiche plus son en-tête non plus — voir le
   * rendu plus bas.
   */
  const navGroups = NAV_GROUPS
    .map(group => ({
      ...group,
      items: group.items.filter(item => planAllowsModule(user?.company?.plan, item.id as PlanModule)),
    }))
    .filter(group => group.items.length > 0);

  // Orthogonal to any company-scoped permission: runs the platform itself
  // (confirms other companies' payments), not this user's own company. Kept
  // outside the three groups above — a platform-admin link isn't a question
  // any of them answers, and it's rare enough (superadmin only) not to need
  // its own header.
  const platformItem: NavItem | null = user?.isPlatformAdmin
    ? { id: 'Plateforme', label: 'Plateforme', icon: Building2, hasChevron: false }
    : null;

  return (
    <>
      {/* Scrim — only ever rendered on mobile, where the rail overlays content. */}
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}
    <aside
      // 212px clipped "Facturation & Trésorerie" (25 chars, the longest nav
      // label) to "Facturation & Trésor…" — its natural width (~149px) needs
      // more room than the ~142px a 212px rail leaves after the icon, gap and
      // button padding. Widened just enough for it to render on one line
      // with `truncate` (unchanged below) still as the safety net for
      // anything longer still.
      className={`w-[226px] min-w-[226px] bg-navy text-white flex flex-col justify-between h-dvh overflow-y-auto select-none font-sans flex-shrink-0
        fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:sticky lg:top-0 lg:z-30 lg:translate-x-0`}
    >
      {/* Top Branding & Nav */}
      <div>
        {/* Brand Logo Header */}
        <div className="px-[18px] pt-5 pb-4 flex items-center gap-[9px]">
          <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shrink-0">
            <Logo size={16} variant="color" />
          </div>
          <span className="text-[14px] font-extrabold tracking-tight text-white truncate">
            Tâches <span className="text-turquoise">&amp;</span> Cash
          </span>
          {/* Closing the drawer needs a target inside it too — reaching the
              scrim behind a full-height rail is awkward on a phone. */}
          <button
            onClick={onClose}
            className="ml-auto p-1 -mr-1 text-white/60 hover:text-white rounded lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation List — grouped under three headers, each answering one
            question: Pilotage & Production (piloter le travail), Finance &
            RH (l'argent et l'équipe), Outils & Collaboration (le reste). A
            group with no visible items (its own header included) simply
            doesn't render — see `navGroups`'s filter above. */}
        <nav className="flex flex-col px-2.5">
          {navGroups.map((group, i) => (
            <div key={group.header} className="flex flex-col gap-px">
              <div className={`flex items-center gap-1.5 px-3 ${i === 0 ? 'pt-1' : 'pt-4'} pb-1.5 text-[12px] font-extrabold uppercase tracking-wider text-turquoise`}>
                <span>•</span> {group.header}
              </div>
              {group.items.map((item) => (
                <NavButton key={item.id} item={item} isActive={activeItem === item.id} onSelect={() => { onSelectItem?.(item.id); onClose?.(); }} />
              ))}
            </div>
          ))}
          {platformItem && (
            <div className="flex flex-col gap-px pt-4">
              <NavButton item={platformItem} isActive={activeItem === platformItem.id} onSelect={() => { onSelectItem?.(platformItem.id); onClose?.(); }} />
            </div>
          )}
        </nav>
      </div>

      {/* Bottom bar — the Settings page was removed; the employer-cost
          configuration now lives entirely in the user form. */}
      <div className="p-4 mt-auto">
        <div className="flex items-center gap-2 px-2">
           <Globe className="w-4 h-4 text-white/60" />
           <select
             value={language}
             onChange={(e) => setLanguage(e.target.value as 'fr' | 'en')}
             className="bg-transparent text-[11px] text-white/80 focus:outline-none cursor-pointer"
           >
             <option value="fr" className="text-black">FR</option>
             <option value="en" className="text-black">EN</option>
           </select>
        </div>
      </div>
    </aside>
    </>
  );
};
