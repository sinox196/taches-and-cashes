import React from 'react';
import { Menu, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { PresenceBadge } from './PresenceBadge';
import { NotificationBell } from './NotificationBell';
import { SubscriptionBadge } from './SubscriptionBadge';

interface HeaderProps {
  onToggleSidebar?: () => void;
  userCode?: string;
  userName?: string;
  /** Switches the active sidebar section — used by the notification bell. */
  onNavigate?: (section: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  userCode = 'ABA01',
  userName = 'Alexandre Dupont',
  onNavigate,
}) => {
  const { logout, user } = useAuth();
  const { own } = usePresence();
  const displayUserName = user?.username || userName;
  const initials = displayUserName.substring(0, 2).toUpperCase();

  return (
    <header className="h-[60px] shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 md:px-8 sticky top-0 z-20 font-sans">
      {/* Left: drawer toggle. Hidden from `lg` up, where the rail is static
          and the button would open nothing. */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors lg:hidden"
          title="Menu"
          aria-label="Ouvrir le menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Right section utilities */}
      <div className="flex items-center gap-4">
        {/* L'abonnement d'abord, et à l'écart du groupe présence/avatar : les
            deux disent « actif » de deux choses différentes, et les coller
            l'un à l'autre est ce qui les faisait lire comme une seule. */}
        <SubscriptionBadge />

        {/* Company Account Identifier */}
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
          {user?.role || userCode}
        </span>

        <div className="flex items-center gap-3 border-l border-gray-200 pl-4">
          <NotificationBell onNavigate={(section) => onNavigate?.(section)} />

          {/* User Avatar + own presence */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center font-bold text-xs border border-gray-200">
                {initials}
              </div>
              {/* Status dot on the avatar, ringed so it reads against it. */}
              <span className="absolute -bottom-0.5 -right-0.5 bg-white rounded-full p-[2px] flex">
                <PresenceBadge state={own} variant="dot" />
              </span>
            </div>
            <span className="text-[12px] font-medium text-gray-700 hidden sm:inline">
              {displayUserName}
            </span>
            <span className="hidden md:inline">
              <PresenceBadge state={own} />
            </span>
          </div>

          <button 
            onClick={() => logout()}
            className="ml-2 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" 
            title="Se déconnecter"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
