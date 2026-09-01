import React from 'react';
import { ROLES } from '../../constants/roles';
import { useAuth } from '../../context/AuthContext';
import { Users2, Clock, CheckCircle, Play, Pause, Briefcase, Calendar, Clock4, Wallet, AlertTriangle } from 'lucide-react';

interface KPICardsProps {
  stats: any;
}

export const KPICards: React.FC<KPICardsProps> = ({ stats }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  // Breakdown driven by the role list, so a new role appears here automatically.
  const byRole: Record<string, number> = stats.headcountByRole ?? {
    COLLABORATOR: stats.totalCollaborators ?? 0,
    SUPERVISEUR: stats.totalSupervisors ?? 0,
  };
  const headcount = stats.totalHeadcount ?? Object.values(byRole).reduce((a, b) => a + b, 0);
  const headcountLabel = ROLES.filter(r => r.isStaff && (byRole[r.id] ?? 0) > 0)
    .map(r => `${byRole[r.id]} ${r.label}${byRole[r.id] > 1 ? 's' : ''}`)
    .join(', ');

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${isAdmin ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {/* Coût employeur — the headline money figure. Admin-only. */}
      {isAdmin && (
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Coût employeur</div>
          {/* Aucune tâche chiffrée ne veut pas dire « zéro dinar » : ça veut
              dire qu'on ne sait pas. Le chiffre le plus visible du tableau de
              bord ne doit pas affirmer que le travail n'a rien coûté — c'est
              la même règle que la colonne du tableau des collaborateurs, qui
              affiche « Non configuré » depuis toujours. */}
          {stats.pricedTasks === 0 && stats.tasksWithoutRate > 0 ? (
            <div
              // Un libellé, pas un montant : à la taille d'un chiffre il se
              // faisait tronquer en « Non con… » dans la largeur de la carte.
              className="text-lg font-bold text-gray-400 leading-8"
              title="Aucune tâche chiffrée : renseignez le salaire brut et le régime horaire dans Utilisateurs. Le taux est figé à la création d'une tâche, donc les tâches déjà pointées restent non chiffrées."
            >
              Non configuré
            </div>
          ) : (
            <div className="text-2xl font-bold text-gray-900 truncate" title={stats.totalCostFormatted}>
              {stats.totalCostFormatted}
            </div>
          )}
          <div className="text-[11px] mt-1">
            {stats.tasksWithoutRate > 0 ? (
              <span
                className="text-amber-700 inline-flex items-center gap-1"
                title="Renseignez le salaire brut et le régime horaire de ces collaborateurs dans Utilisateurs."
              >
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {stats.tasksWithoutRate} tâche{stats.tasksWithoutRate > 1 ? 's' : ''} non chiffrée{stats.tasksWithoutRate > 1 ? 's' : ''}
              </span>
            ) : (
              <span className="text-gray-400">{stats.totalDurationFormatted} pointées</span>
            )}
          </div>
        </div>
        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center shrink-0">
          <Wallet className="w-6 h-6" />
        </div>
      </div>
      )}

      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Effectif</div>
          <div className="text-2xl font-bold text-gray-900">{headcount}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            {headcountLabel || 'Aucun collaborateur'}
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
