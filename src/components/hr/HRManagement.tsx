import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { CalendarRange, Clock, AlertCircle, CheckCircle2, User } from 'lucide-react';
import { LeavesTab } from './LeavesTab';
import { AbsencesTab } from './AbsencesTab';
import { LoansTab } from './LoansTab';
import { AdvancesTab } from './AdvancesTab';
import { LeaveBalance } from '../../types';

export const HRManagement: React.FC = () => {
  const { hasPermission, token } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'leaves' | 'absences' | 'loans' | 'advances'>('leaves');
  const [balance, setBalance] = useState<LeaveBalance | null>(null);

  const loadBalance = () => {
    if (token) {
      fetch('/api/hr/balance', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => setBalance(data))
        .catch(console.error);
    }
  };

  useEffect(() => {
    loadBalance();
    window.addEventListener('refresh-hr-balance', loadBalance);
    return () => window.removeEventListener('refresh-hr-balance', loadBalance);
  }, [token]);

  if (!hasPermission('VIEW_HR')) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas accès à ce module.
      </div>
    );
  }

  return (
    // `min-h-0` : sans lui, un enfant `flex-1` ne peut pas descendre sous la
    // taille de son contenu, la page grandit, et la barre de pagination du
    // tableau se retrouve sous la ligne de flottaison. Même montage que la
    // page Clients.
    <main className="p-4 sm:p-6 lg:p-8 flex-1 min-h-0 flex flex-col space-y-4 sm:space-y-6 max-w-[1400px] w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('hr.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('hr.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t('hr.balance.available')} ({t('hr.balance.days')})</p>
            <h3 className="text-2xl font-bold text-gray-900">{balance ? balance.available : '-'}</h3>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
            <CalendarRange className="w-5 h-5 text-blue-600" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t('hr.balance.used')} ({t('hr.balance.days')})</p>
            <h3 className="text-2xl font-bold text-gray-900">{balance ? balance.used : '-'}</h3>
          </div>
          <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center">
            <Clock className="w-5 h-5 text-orange-600" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden flex flex-col flex-1 min-h-0">
        {/* Scrolls sideways below sm: four tabs sharing 390px squeezed
            "Autorisations d'absence" onto two lines and clipped the rest. */}
        <div className="flex border-b border-gray-200 overflow-x-auto shrink-0">
          <button
            onClick={() => setActiveTab('leaves')}
            className={`shrink-0 whitespace-nowrap sm:flex-1 py-3 px-4 text-sm font-medium text-center transition-colors ${activeTab === 'leaves' ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t('hr.tabs.leaves')}
          </button>
          <button
            onClick={() => setActiveTab('absences')}
            className={`shrink-0 whitespace-nowrap sm:flex-1 py-3 px-4 text-sm font-medium text-center transition-colors ${activeTab === 'absences' ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t('hr.tabs.absences')}
          </button>
          <button
            onClick={() => setActiveTab('loans')}
            className={`shrink-0 whitespace-nowrap sm:flex-1 py-3 px-4 text-sm font-medium text-center transition-colors ${activeTab === 'loans' ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Prêts
          </button>
          <button
            onClick={() => setActiveTab('advances')}
            className={`shrink-0 whitespace-nowrap sm:flex-1 py-3 px-4 text-sm font-medium text-center transition-colors ${activeTab === 'advances' ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Avances
          </button>
        </div>

        {/* Ne défile plus lui-même : chaque onglet fait défiler son tableau et
            garde sa barre de pagination en dehors, comme le Brouillard de
            caisse. Un `overflow-auto` ici ferait défiler la barre avec le
            contenu, et il faudrait descendre tout en bas pour l'atteindre. */}
        <div className="p-4 flex-1 min-h-0 flex flex-col">
          {activeTab === 'leaves' ? <LeavesTab />
            : activeTab === 'absences' ? <AbsencesTab />
            : activeTab === 'loans' ? <LoansTab />
            : <AdvancesTab />}
        </div>
      </div>
    </main>
  );
};
