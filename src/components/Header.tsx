import React from 'react';
import { Menu, Bell, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  onToggleSidebar?: () => void;
  userCode?: string;
  userName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  userCode = 'ABA01',
  userName = 'Alexandre Dupont',
}) => {
  const { logout, user } = useAuth();
  const displayUserName = user?.username || userName;
  const initials = displayUserName.substring(0, 2).toUpperCase();

  return (
    <header className="h-[60px] bg-white border-b border-gray-200 flex items-center justify-between px-6 md:px-8 sticky top-0 z-20 font-sans">
      {/* Left section with hamburger menu */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors"
          title="Menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Right section utilities */}
      <div className="flex items-center gap-4">
        {/* Company Account Identifier */}
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
          {user?.role || userCode}
        </span>

        <div className="flex items-center gap-3 border-l border-gray-200 pl-4">
          {/* Notification Icon with Red Badge */}
          <button className="relative p-1 text-gray-500 hover:text-gray-800 rounded transition-colors" title="Notifications">
            <Bell className="w-5 h-5" />
            <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 border border-white rounded-full"></div>
          </button>

          {/* User Avatar */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#101828] text-white flex items-center justify-center font-bold text-xs border border-gray-200">
              {initials}
            </div>
            <span className="text-[12px] font-medium text-gray-700 hidden sm:inline">
              {displayUserName}
            </span>
          </div>

          <button 
            onClick={logout}
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
