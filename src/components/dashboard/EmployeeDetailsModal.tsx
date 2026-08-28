import React from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { X, User, CheckCircle2, Clock, Pause, Briefcase, Calendar, Clock4, AlertCircle } from 'lucide-react';
import { roleMeta, roleLabel } from '../../constants/roles';

interface EmployeeDetailsModalProps {
  employee: any;
  onClose: () => void;
  /** Opens the per-task drill-down (EmployeeTasksModal), pre-filtered to one
   *  client — the aggregate duration shown here has nothing to break down
   *  by task, that view already does and is loaded on demand from there. */
  onViewClientTasks?: (clientName: string) => void;
}

export const EmployeeDetailsModal: React.FC<EmployeeDetailsModalProps> = ({ employee, onClose, onViewClientTasks }) => {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-opacity">
      <div 
        className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col transform transition-transform"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${roleMeta(employee.role).badgeClass}`}>
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-gray-900">{employee.name}</h2>
              <div className="text-[12px] text-gray-500">{roleLabel(employee.role)} • {employee.department}</div>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Tâches */}
          <section>
            <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Performances Tâches
            </h3>
            
            {/* Durée et Coût totaux */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide mb-0.5">Durée Totale</div>
                  <div className="text-2xl font-black text-blue-900 font-mono">
                    {employee.totalDurationFormatted || employee.tasks?.totalDurationFormatted || '0h00'}
                  </div>
                  <div className="text-[11px] text-blue-600/80 mt-0.5">Temps de travail cumulé</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700">
                  <Clock className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide mb-0.5">Coût Total</div>
                  <div className="text-2xl font-black text-emerald-900">
                    {employee.totalCostFormatted || employee.tasks?.totalCostFormatted || '0 TND'}
                  </div>
                  <div className="text-[11px] text-emerald-600/80 mt-0.5">Valorisation financière</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                  <AlertCircle className="w-5 h-5" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div className="text-[11px] text-gray-500 mb-1">Total Assignées</div>
                <div className="text-xl font-bold text-gray-900">{employee.tasks.total}</div>
              </div>
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                <div className="text-[11px] text-emerald-600 mb-1">Terminées</div>
                <div className="text-xl font-bold text-emerald-700">{employee.tasks.completed}</div>
              </div>
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100">
                <div className="text-[11px] text-amber-600 mb-1">En cours</div>
                <div className="text-xl font-bold text-amber-700">{employee.tasks.inProgress}</div>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div className="text-[11px] text-gray-500 mb-1">En pause</div>
                <div className="text-xl font-bold text-gray-700">{employee.tasks.paused}</div>
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-xl border border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold text-gray-900">Taux de réalisation</div>
                <div className="text-[11px] text-gray-500">Tâches terminées sur le total assigné</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${employee.tasks.completionRate > 80 ? 'bg-emerald-500' : employee.tasks.completionRate > 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${employee.tasks.completionRate}%` }}
                  />
                </div>
                <span className="text-[14px] font-bold text-gray-900 w-12 text-right">{Math.round(employee.tasks.completionRate)}%</span>
              </div>
            </div>
          </section>

          {/* Clients */}
          <section>
            <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Clients Traités ({employee.clients.totalHandled})
            </h3>
            {employee.clients.list.length > 0 ? (
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                {employee.clients.list.map((client: any) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => onViewClientTasks?.(client.name)}
                    title="Voir le détail par tâche"
                    className="w-full p-3 flex justify-between items-center hover:bg-gray-50 text-left"
                  >
                    <span className="text-[13px] font-medium text-gray-900">{client.name}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        {client.taskCount} tâche(s)
                      </span>
                      <span className="text-[11px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-mono font-medium">
                        {client.durationFormatted ?? '0h00'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-gray-500 italic p-4 bg-gray-50 rounded-xl border border-gray-100 text-center">
                Aucun client traité sur cette période.
              </div>
            )}
          </section>

          {/* Congés & Autorisations */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Congés
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg">
                  <span className="text-[12px] text-gray-600">Droit annuel</span>
                  <span className="text-[13px] font-bold text-gray-900">{employee.leaves.balance.available} j</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-rose-50/50 border border-rose-100 rounded-lg">
                  <span className="text-[12px] text-rose-600 font-medium">Jours pris (Approuvés)</span>
                  <span className="text-[13px] font-bold text-rose-700">{employee.leaves.daysTaken} j</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg">
                  <span className="text-[12px] text-emerald-600 font-medium">Solde restant</span>
                  <span className="text-[13px] font-bold text-emerald-700">{Math.max(0, employee.leaves.balance.available - employee.leaves.daysTaken)} j</span>
                </div>
                
                <div className="pt-2 border-t border-gray-100 flex gap-4">
                  <div className="flex-1 text-center">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">En attente</div>
                    <div className="text-[14px] font-bold text-amber-600">{employee.leaves.pending}</div>
                  </div>
                  <div className="flex-1 text-center border-l border-gray-100">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Refusés</div>
                    <div className="text-[14px] font-bold text-red-600">{employee.leaves.rejected}</div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Clock4 className="w-4 h-4" />
                Autorisations
              </h3>
              <div className="bg-white border border-gray-100 rounded-xl p-4 mb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[12px] text-gray-500">Durée totale (Approuvée)</span>
                  <span className="text-[14px] font-bold text-gray-900">{employee.authorizations.totalDuration}h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">Demandes totales</span>
                  <span className="text-[13px] font-medium text-gray-700">{employee.authorizations.total}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-emerald-50/50 border border-emerald-100 p-2 rounded-lg text-center">
                  <div className="text-[16px] font-bold text-emerald-600">{employee.authorizations.approved}</div>
                  <div className="text-[10px] text-emerald-700">Approuvées</div>
                </div>
                <div className="bg-amber-50/50 border border-amber-100 p-2 rounded-lg text-center">
                  <div className="text-[16px] font-bold text-amber-600">{employee.authorizations.pending}</div>
                  <div className="text-[10px] text-amber-700">En attente</div>
                </div>
                <div className="bg-gray-50 border border-gray-100 p-2 rounded-lg text-center">
                  <div className="text-[16px] font-bold text-gray-600">{employee.authorizations.rejected}</div>
                  <div className="text-[10px] text-gray-500">Refusées</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
