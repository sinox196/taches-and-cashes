import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useAuth } from '../../context/AuthContext';
import { LeaveRequest } from '../../types';
import { Plus, Check, X, Clock, AlertCircle } from 'lucide-react';
import { ExportButton } from '../ExportButton';
import { csvNumber } from '../../utils/exportCsv';

export const LeavesTab: React.FC = () => {
  const { token, hasPermission, user } = useAuth();
  const [leaves, setLeaves] = useState<(LeaveRequest & { userName?: string, approverName?: string, approvedByName?: string })[]>([]);
  const [approvers, setApprovers] = useState<{id: number, name: string, role: string}[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  
  // Form state
  const [type, setType] = useState('Congé annuel');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [duration, setDuration] = useState(1);
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const [dateError, setDateError] = useState('');

  React.useEffect(() => {
    if (startDate && endDate) {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      if (end < start) {
        setDateError('La date de fin ne peut pas être antérieure à la date de début.');
        setDuration(0);
      } else {
        setDateError('');
        const diffDays = (end - start) / (1000 * 3600 * 24);
        setDuration(diffDays);
      }
    } else {
      setDateError('');
      setDuration(0);
    }
  }, [startDate, endDate]);

  const [approvalModalId, setApprovalModalId] = useState<number | null>(null);
  const [approvalComment, setApprovalComment] = useState('');

  const [rejectionModalId, setRejectionModalId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  useEscapeToClose(() => setIsCreating(false), isCreating);
  useEscapeToClose(() => { setApprovalModalId(null); setApprovalComment(''); }, !!approvalModalId);
  useEscapeToClose(() => { setRejectionModalId(null); setRejectionReason(''); }, !!rejectionModalId);

  const fetchLeaves = () => {
    fetch('/api/hr/leaves', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setLeaves(data))
      .catch(console.error);
  };

  const fetchApprovers = () => {
    fetch('/api/hr/approvers', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setApprovers(data))
      .catch(console.error);
  };

  useEffect(() => {
    if (token) {
      fetchLeaves();
      fetchApprovers();
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dateError) {
      alert(dateError);
      return;
    }
    if (duration <= 0) {
      alert('La durée doit être supérieure à 0.');
      return;
    }
    if (!approverId) {
      alert('Veuillez sélectionner un responsable pour approuver.');
      return;
    }
    try {
      const res = await fetch('/api/hr/leaves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ type, startDate, endDate, duration, reason, approverId })
      });
      if (res.ok) {
        setIsCreating(false);
        fetchLeaves();
        // Reset form
        setStartDate('');
        setEndDate('');
        setDuration(1);
        setReason('');
        setApproverId('');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/leaves/${id}/approve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ comment: approvalComment })
      });
      if (res.ok) {
        setApprovalModalId(null);
        setApprovalComment('');
        fetchLeaves();
        window.dispatchEvent(new Event('refresh-hr-balance'));
      } else {
        const err = await res.json();
        alert(err.error || "Échec de l'approbation");
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleReject = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/leaves/${id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ comment: rejectionReason })
      });
      if (res.ok) {
        setRejectionModalId(null);
        setRejectionReason('');
        fetchLeaves();
        window.dispatchEvent(new Event('refresh-hr-balance'));
      } else {
        const err = await res.json();
        alert(err.error || "Échec du refus");
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleCancel = async (id: number) => {
    if (!confirm('Voulez-vous vraiment annuler cette demande ?')) return;
    try {
      const res = await fetch(`/api/hr/leaves/${id}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchLeaves();
        // Optionnel: on pourrait remonter pour recharger le solde dans HRManagement
        window.dispatchEvent(new Event('refresh-hr-balance'));
      } else {
        const err = await res.json();
        alert(err.error || "Échec de l'annulation");
      }
    } catch (error) {
      console.error(error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING': return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700"><Clock className="w-3.5 h-3.5" /> En attente</span>;
      case 'APPROVED': return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700"><Check className="w-3.5 h-3.5" /> Approuvé</span>;
      case 'REJECTED': return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700"><X className="w-3.5 h-3.5" /> Refusé</span>;
      case 'CANCELLED': return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-gray-50 text-gray-700"><AlertCircle className="w-3.5 h-3.5" /> Annulé</span>;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Demandes de congés</h2>
        <div className="flex items-center gap-2 self-start">
            <ExportButton fileName="conges" rows={leaves} columns={[
                { header: 'Employé', value: (r: any) => r.userName || '' },
                { header: 'Responsable', value: (r: any) => r.approverName || '' },
                { header: 'Type', value: (r: any) => r.type },
                { header: 'Du', value: (r: any) => r.startDate },
                { header: 'Au', value: (r: any) => r.endDate },
                { header: 'Durée (jours)', value: (r: any) => r.duration },
                { header: 'Motif', value: (r: any) => r.reason || '' },
                { header: 'Statut', value: (r: any) => r.status },
            ]} />
        {hasPermission('CREATE_LEAVE_REQUEST') && (
          <button
            onClick={() => setIsCreating(true)}
            className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-navy-hover transition-colors flex items-center gap-2 self-start shrink-0 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Nouvelle demande
          </button>
        )}
        </div>
      </div>

      <div className="overflow-x-auto flex-1 border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {hasPermission('MANAGE_LEAVE_REQUESTS') && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employé</th>}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Responsable</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dates</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Durée</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {leaves.length === 0 ? (
              <tr>
                <td colSpan={hasPermission('MANAGE_LEAVE_REQUESTS') ? 6 : 5} className="px-6 py-8 text-center text-sm text-gray-500">
                  Aucune demande trouvée.
                </td>
              </tr>
            ) : (
              leaves.map((leave) => (
                <tr key={leave.id} className="hover:bg-gray-50">
                  {hasPermission('MANAGE_LEAVE_REQUESTS') && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {leave.userName}
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{leave.approverName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{leave.type}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {leave.startDate} au {leave.endDate}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{leave.duration} jours</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(leave.status)}
                    {(leave.status === 'REJECTED' || leave.status === 'APPROVED') && leave.approverComment && (
                      <p className="text-[10px] text-gray-500 mt-1 max-w-[150px] truncate" title={leave.approverComment}>
                        Commentaire: {leave.approverComment}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      {hasPermission('MANAGE_LEAVE_REQUESTS') && (user?.role === 'ADMIN' || user?.id === leave.approverId) && leave.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => setApprovalModalId(leave.id)}
                            className="text-emerald-600 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 p-1.5 rounded-md transition-colors"
                            title="Approuver"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRejectionModalId(leave.id)}
                            className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-1.5 rounded-md transition-colors"
                            title="Refuser"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {(leave.status === 'PENDING' || leave.status === 'APPROVED') && (
                        <button
                          onClick={() => handleCancel(leave.id)}
                          className="text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 p-1.5 rounded-md transition-colors"
                          title="Annuler"
                        >
                          <AlertCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Approval Modal */}
      {approvalModalId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Approuver la demande</h3>
              <textarea
                value={approvalComment}
                onChange={(e) => setApprovalComment(e.target.value)}
                placeholder="Commentaire (optionnel)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 min-h-[100px]"
              />
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setApprovalModalId(null); setApprovalComment(''); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => handleApprove(approvalModalId)}
                  className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                >
                  Confirmer l'approbation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectionModalId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Refuser la demande</h3>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Raison du refus (obligatoire)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 min-h-[100px]"
              />
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setRejectionModalId(null); setRejectionReason(''); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(rejectionModalId)}
                  disabled={!rejectionReason.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  Confirmer le refus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Creation Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Demander un congé</h2>
              <button
                onClick={() => setIsCreating(false)}
                className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <form id="leave-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type de congé</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  >
                    <option value="Congé annuel">Congé annuel</option>
                    <option value="Congé maladie">Congé maladie</option>
                    <option value="Congé exceptionnel">Congé exceptionnel</option>
                    <option value="Autre">Autre</option>
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date de début</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date de fin</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (en jours)</label>
                  <input
                    type="text"
                    value={duration > 0 ? `${duration} ${duration > 1 ? 'jours' : 'jour'}` : '0 jour'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                    readOnly
                    required
                  />
                  {dateError && (
                    <p className="mt-1 text-[12px] text-red-600 font-medium">{dateError}</p>
                  )}
                  {!dateError && duration === 0 && startDate && endDate && (
                    <p className="mt-1 text-[12px] text-amber-600 font-medium">La durée doit être supérieure à 0 (les dates ne peuvent pas être identiques si la formule est Date Fin - Date Début).</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responsable d'approbation</label>
                  <select
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  >
                    <option value="" disabled>Sélectionner un responsable</option>
                    {approvers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motif</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 min-h-[80px]"
                    required
                  />
                </div>
              </form>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              >
                Annuler
              </button>
              <button
                type="submit"
                form="leave-form"
                className="px-4 py-2 text-sm font-medium text-white bg-navy border border-transparent rounded-lg hover:bg-navy-hover focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              >
                Soumettre
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
