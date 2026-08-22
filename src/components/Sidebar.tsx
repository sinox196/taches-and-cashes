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
  ShieldAlert,
  Layers,
  Globe,
  MessageCircle,
  FileCheck2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface SidebarProps {
  activeItem?: string;
  onSelectItem?: (item: string) => void;
  collapsed?: boolean;
  /** Unread chat messages, shown as a badge on the Messages nav item. */
  unreadMessages?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem = 'Time Tracking',
  onSelectItem,
  unreadMessages = 0,
}) => {
  const { hasPermission } = useAuth();
  const { t, language, setLanguage } = useLanguage();

  // Every authenticated user gets a "Dashboard" entry: DASHBOARD_ROLES see the
  // team-wide AdminDashboard, everyone else gets their own personal KPIs
  // (MyDashboard) — the routing decision lives in App.tsx.
  const mainNavItems: { id: string; label: string; icon: any; hasChevron: boolean; badge?: number }[] = [
    { id: 'Dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, hasChevron: false },
    ...(hasPermission('VIEW_CLIENTS') ? [{ id: 'Clients', label: t('nav.clients'), icon: Users, hasChevron: false }] : []),
    { id: 'Time Tracking', label: t('nav.timeTracking'), icon: Clock, hasChevron: true },
    { id: 'Messages', label: 'Messages', icon: MessageCircle, hasChevron: false, badge: unreadMessages },
    ...(hasPermission('MANAGE_SERVICES') ? [{ id: 'Missions', label: 'Missions', icon: Layers, hasChevron: false }] : []),
    ...(hasPermission('VIEW_RESOURCES') ? [{ id: 'Ressources', label: 'Ressources métier', icon: FileCheck2, hasChevron: false }] : []),
    ...(hasPermission('VIEW_CASH') ? [{ id: 'Cash', label: 'Cash', icon: Receipt, hasChevron: false }] : []),
    ...(hasPermission('VIEW_HR') ? [{ id: 'HR', label: t('nav.hr'), icon: Users2, hasChevron: true }] : []),
  ];

  if (hasPermission('MANAGE_USERS')) {
    mainNavItems.push({ id: 'Users', label: t('nav.users'), icon: ShieldAlert, hasChevron: false });
  }

  return (
    <aside
      className="w-[212px] min-w-[212px] bg-navy text-white flex flex-col justify-between h-screen sticky top-0 z-30 select-none font-sans flex-shrink-0"
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
        </div>

        {/* Navigation List */}
        <nav className="flex flex-col gap-px px-2.5">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSelectItem?.(item.id)}
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
  );
};
