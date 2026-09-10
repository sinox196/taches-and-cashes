import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { CalendarRange, Clock, AlertCircle, CheckCircle2, User, Wallet, DollarSign, Flag } from 'lucide-react';
import { LeavesTab } from './LeavesTab';
import { AbsencesTab } from './AbsencesTab';
import { LoansTab } from './LoansTab';
import { AdvancesTab } from './AdvancesTab';
import { AttendanceTab } from './AttendanceTab';
import { HolidaysTab } from './HolidaysTab';
import { LeaveBalance } from '../../types';

export const HRManagement: React.FC = () => {
  const { hasPermission, token } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'leaves' | 'absences' | 'loans' | 'advances' | 'attendance' | 'holidays'>('leaves');
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
    // Le tableau de chaque onglet fait défiler son propre corps et garde sa
    // barre de pagination en dehors — mais **jamais sous une hauteur
    // utilisable**. La chaîne `flex-1 min-h-0` de bout en bout laissait le
    // scrollport se faire écraser par ce qui le précède : mesuré à 112 px sur
    // un 1280x720 (l'en-tête, les cartes de solde, la barre d'onglets et la
    // carte de pointage prennent 594 px à elles seules), soit l'en-tête du
    // tableau et une ligne et demie — on ne pouvait plus y défiler.
    //
    // Chaque scrollport porte donc un plancher (`sm:min-h-[260px]`, cinq
    // lignes) au lieu de `min-h-0`, et cette chaîne-ci ne force plus la
    // descente : sur un écran assez haut rien ne change (le tableau prend
    // toute la place restante), sur un écran court le contenu dépasse et
    // c'est la colonne de l'application qui défile — la barre de pagination
    // suit alors le tableau dans le flux, comme sur téléphone.
    <main className="p-4 sm:p-6 lg:p-8 sm:flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1400px] w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('hr.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('hr.subtitle')}</p>
        </div>
      </div>

      {/* Always two even columns — there are only ever two stat cards here,
          and `lg:grid-cols-4` left the right half of the row empty on a
          desktop-width screen instead of letting the pair fill it. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 shrink-0">
        <div className="bg-white p-3 sm:p-5 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between gap-2">
          <div>
            <p className="text-[12px] sm:text-sm font-medium text-gray-500 mb-0.5 sm:mb-1 leading-snug">{t('hr.balance.available')} ({t('hr.balance.days')})</p>
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900">{balance ? balance.available : '-'}</h3>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 hidden sm:flex items-center justify-center shrink-0">
            <CalendarRange className="w-5 h-5 text-blue-600" />
          </div>
        </div>
        <div className="bg-white p-3 sm:p-5 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between gap-2">
          <div>
            <p className="text-[12px] sm:text-sm font-medium text-gray-500 mb-0.5 sm:mb-1 leading-snug">{t('hr.balance.used')} ({t('hr.balance.days')})</p>
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900">{balance ? balance.used : '-'}</h3>
          </div>
          <div className="w-10 h-10 rounded-full bg-orange-50 hidden sm:flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-orange-600" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden flex flex-col sm:flex-1">
        {/* Left-aligned, natural width, scrolling sideways rather than
            stretching to fill the row or wrapping — same idiom as Cash's and
            Tâches' own tab bars, so the three read as one pattern. `flex-1`
            used to squeeze "Autorisations d'absence" onto two lines on a
            narrow desktop window.
            Chaque onglet garde sa propre couleur — reprise sur l'en-tête du
            tableau qu'il affiche (LeavesTab/AbsencesTab/AttendanceTab/
            LoansTab/AdvancesTab) — pour qu'un coup d'œil dise sous quel
            onglet on se trouve, même logique que les sous-vues de Tâches. */}
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto shrink-0">
          {([
            { id: 'leaves' as const, label: t('hr.tabs.leaves'), icon: CalendarRange, border: 'border-indigo-600', text: 'text-indigo-700' },
            { id: 'absences' as const, label: t('hr.tabs.absences'), icon: Clock, border: 'border-rose-600', text: 'text-rose-700' },
            { id: 'attendance' as const, label: 'Pointage', icon: User, border: 'border-orange-600', text: 'text-orange-700' },
            { id: 'loans' as const, label: 'Prêts', icon: Wallet, border: 'border-teal-600', text: 'text-teal-700' },
            { id: 'advances' as const, label: 'Avances', icon: DollarSign, border: 'border-cyan-600', text: 'text-cyan-700' },
            { id: 'holidays' as const, label: 'Jours fériés', icon: Flag, border: 'border-fuchsia-600', text: 'text-fuchsia-700' },
          ]).map(tabDef => (
            <button
              key={tabDef.id}
              onClick={() => setActiveTab(tabDef.id)}
              className={`flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3.5 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tabDef.id ? `${tabDef.border} ${tabDef.text}` : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tabDef.icon className="w-4 h-4" /> {tabDef.label}
            </button>
          ))}
        </div>

        {/* Ne défile plus lui-même : chaque onglet fait défiler son tableau et
            garde sa barre de pagination en dehors, comme le Brouillard de
            caisse. Un `overflow-auto` ici ferait défiler la barre avec le
            contenu, et il faudrait descendre tout en bas pour l'atteindre. */}
        <div className="p-4 flex flex-col sm:flex-1">
          {activeTab === 'leaves' ? <LeavesTab />
            : activeTab === 'absences' ? <AbsencesTab />
            : activeTab === 'attendance' ? <AttendanceTab />
            : activeTab === 'loans' ? <LoansTab />
            : activeTab === 'advances' ? <AdvancesTab />
            : <HolidaysTab />}
        </div>
      </div>
    </main>
  );
};
