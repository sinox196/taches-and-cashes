import React from 'react';
import { Users2, Clock, CheckCircle, Play, Pause, Briefcase, Calendar, Clock4 } from 'lucide-react';

interface KPICardsProps {
  stats: any;
}

export const KPICards: React.FC<KPICardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Effectif</div>
          <div className="text-2xl font-bold text-gray-900">{stats.totalCollaborators + stats.totalSupervisors}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            {stats.totalCollaborators} Collaborateurs, {stats.totalSupervisors} Superviseurs
          </div>
        </div>
        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
          <Users2 className="w-6 h-6" />
        </div>
      </div>
      
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Tâches (Total)</div>
          <div className="text-2xl font-bold text-gray-900">{stats.totalTasks}</div>
          <div className="flex gap-2 mt-1">
            <span className="text-[11px] text-emerald-600 flex items-center"><CheckCircle className="w-3 h-3 mr-0.5" />{stats.completedTasks}</span>
            <span className="text-[11px] text-amber-600 flex items-center"><Play className="w-3 h-3 mr-0.5" />{stats.inProgressTasks}</span>
            <span className="text-[11px] text-gray-500 flex items-center"><Pause className="w-3 h-3 mr-0.5" />{stats.pausedTasks}</span>
          </div>
        </div>
        <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center">
          <Clock className="w-6 h-6" />
        </div>
      </div>

      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Clients Traités</div>
          <div className="text-2xl font-bold text-gray-900">{stats.clientsHandled}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            Clients uniques sur la période
          </div>
        </div>
        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
          <Briefcase className="w-6 h-6" />
        </div>
      </div>

      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">RH en cours</div>
          <div className="text-2xl font-bold text-gray-900">{stats.activeLeaves + stats.activeAuthorizations}</div>
          <div className="flex gap-2 mt-1 text-[11px] text-gray-500">
            <span className="flex items-center"><Calendar className="w-3 h-3 mr-0.5" /> {stats.activeLeaves} Congés</span>
            <span className="flex items-center"><Clock4 className="w-3 h-3 mr-0.5" /> {stats.activeAuthorizations} Autos</span>
          </div>
        </div>
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
          <Calendar className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
};
