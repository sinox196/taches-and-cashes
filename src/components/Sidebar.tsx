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
  Building2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
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
  const mainNavItems: { id: string; label: string; icon: any; hasChevron: boolean; badge?: number }[] = [
    { id: 'Dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, hasChevron: false },
    ...(hasPermission('MANAGE_USERS') ? [{ id: 'Users', label: t('nav.users'), icon: Users2, hasChevron: false }] : []),
    ...(hasPermission('MANAGE_SERVICES') ? [{ id: 'Missions', label: 'Missions', icon: Layers, hasChevron: false }] : []),
    ...(hasPermission('VIEW_CLIENTS') ? [{ id: 'Clients', label: t('nav.clients'), icon: Users, hasChevron: false }] : []),
    { id: 'Time Tracking', label: t('nav.timeTracking'), icon: Clock, hasChevron: true },
    ...(hasPermission('VIEW_RESOURCES') ? [{ id: 'Ressources', label: 'Ressources métier', icon: FileCheck2, hasChevron: false }] : []),
    { id: 'Messages', label: 'Messages', icon: MessageCircle, hasChevron: false, badge: unreadMessages },
    ...(hasPermission('VIEW_CASH') ? [{ id: 'Cash', label: 'Cash', icon: Receipt, hasChevron: false }] : []),
    // UserCheck, not Users2: Équipe took the plain "group of people" mark, and
    // two nav items sharing one icon is unreadable at 16px.
    ...(hasPermission('VIEW_HR') ? [{ id: 'HR', label: t('nav.hr'), icon: UserCheck, hasChevron: true }] : []),
  ];

  // Orthogonal to any company-scoped permission: runs the platform itself
  // (confirms other companies' payments), not this user's own company.
  if (user?.isPlatformAdmin) {
    mainNavItems.push({ id: 'Plateforme', label: 'Plateforme', icon: Building2, hasChevron: false });
  }

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
      className={`w-[212px] min-w-[212px] bg-navy text-white flex flex-col justify-between h-dvh overflow-y-auto select-none font-sans flex-shrink-0
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

        {/* Navigation List */}
        <nav className="flex flex-col gap-px px-2.5">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;

            return (
              <button
                key={item.id}
                onClick={() => { onSelectItem?.(item.id); onClose?.(); }}
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
          })}
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
