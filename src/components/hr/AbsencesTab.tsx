import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AbsenceAuthorization } from '../../types';
import { Plus, Check, X, Clock, AlertCircle } from 'lucide-react';

export const AbsencesTab: React.FC = () => {
  const { token, hasPermission, user } = useAuth();
  const [auths, setAuths] = useState<(AbsenceAuthorization & { userName?: string, approverName?: string, approvedByName?: string })[]>([]);
  const [approvers, setApprovers] = useState<{id: number, name: string, role: string}[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  
  // Form state
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [duration, setDuration] = useState(1);
  const [reason, setReason] = useState('Personal appointment');
  const [comment, setComment] = useState('');
  const [approverId, setApproverId] = useState('');
  const [timeError, setTimeError] = useState('');

  React.useEffect(() => {
    if (startTime && endTime) {
      const startParts = startTime.split(':');
      const endParts = endTime.split(':');
      const startMins = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
      const endMins = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
      const diffMins = endMins - startMins;

      if (diffMins < 0) {
        setTimeError("L'heure de fin ne peut pas être antérieure à l'heure de début.");
        setDuration(0);
      } else if (diffMins === 0) {
        setTimeError("La durée doit être supérieure à 0.");
        setDuration(0);
      } else {
        setTimeError('');
        setDuration(diffMins / 60);
      }
    } else {
      setTimeError('');
      setDuration(0);
    }
  }, [startTime, endTime]);

  const [approvalModalId, setApprovalModalId] = useState<number | null>(null);
  const [approvalComment, setApprovalComment] = useState('');

  const [rejectionModalId, setRejectionModalId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const fetchAuths = () => {
    fetch('/api/hr/authorizations', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAuths(data))
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
      fetchAuths();
      fetchApprovers();
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (timeError) {
      alert(timeError);
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
      const res = await fetch('/api/hr/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ date, startTime, endTime, duration, reason, comment, approverId })
      });
      if (res.ok) {
        setIsCreating(false);
        fetchAuths();
        // Reset form
        setDate('');
        setStartTime('');
        setEndTime('');
        setDuration(1);
        setComment('');
        setApproverId('');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/authorizations/${id}/approve`, {
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
        fetchAuths();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to approve');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleReject = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/authorizations/${id}/reject`, {
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
        fetchAuths();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to reject');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleCancel = async (id: number) => {
    if (!confirm('Voulez-vous vraiment annuler cette autorisation ?')) return;
    try {
      const res = await fetch(`/api/hr/authorizations/${id}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchAuths();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to cancel');
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
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Autorisations d'absence</h2>
        {hasPermission('CREATE_ABSENCE_AUTHORIZATION') && (
          <button
            onClick={() => setIsCreating(true)}
            className="bg-[#101828] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#1d2939] transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nouvelle autorisation
          </button>
        )}
      </div>

      <div className="overflow-x-auto flex-1 border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {hasPermission('MANAGE_ABSENCE_AUTHORIZATIONS') && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employé</th>}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Responsable</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Horaire</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Motif</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {auths.length === 0 ? (
              <tr>
                <td colSpan={hasPermission('MANAGE_ABSENCE_AUTHORIZATIONS') ? 6 : 5} className="px-6 py-8 text-center text-sm text-gray-500">
                  Aucune autorisation trouvée.
                </td>
              </tr>
            ) : (
              auths.map((auth) => (
                <tr key={auth.id} className="hover:bg-gray-50">
                  {hasPermission('MANAGE_ABSENCE_AUTHORIZATIONS') && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {auth.userName}
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{auth.approverName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{auth.date}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {auth.startTime} - {auth.endTime} ({auth.duration}h)
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate" title={auth.comment}>
                    <span className="font-medium">{auth.reason}</span>
                    {auth.comment && <span className="block text-gray-500 text-xs mt-0.5 truncate">{auth.comment}</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(auth.status)}
                    {(auth.status === 'REJECTED' || auth.status === 'APPROVED') && auth.approverComment && (
                      <p className="text-[10px] text-gray-500 mt-1 max-w-[150px] truncate" title={auth.approverComment}>
                        Commentaire: {auth.approverComment}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      {hasPermission('MANAGE_ABSENCE_AUTHORIZATIONS') && (user?.role === 'ADMIN' || user?.id === auth.approverId) && auth.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => setApprovalModalId(auth.id)}
                            className="text-emerald-600 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 p-1.5 rounded-md transition-colors"
                            title="Approuver"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRejectionModalId(auth.id)}
                            className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-1.5 rounded-md transition-colors"
                            title="Refuser"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {(auth.status === 'PENDING' || auth.status === 'APPROVED') && (
                        <button
                          onClick={() => handleCancel(auth.id)}
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
              <h3 className="text-lg font-bold text-gray-900 mb-4">Refuser l'autorisation</h3>
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
              <h2 className="text-lg font-bold text-gray-900">Demander une autorisation</h2>
              <button
                onClick={() => setIsCreating(false)}
                className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <form id="auth-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Heure de début</label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Heure de fin</label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (en heures)</label>
                  <input
                    type="text"
                    value={duration > 0 ? `${Math.floor(duration)}h${(duration % 1) * 60 === 0 ? '00' : Math.round((duration % 1) * 60)}` : '0h00'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                    readOnly
                    required
                  />
                  {timeError && (
                    <p className="mt-1 text-[12px] text-red-600 font-medium">{timeError}</p>
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
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  >
                    <option value="Personal appointment">Rendez-vous personnel</option>
                    <option value="Administrative procedure">Démarche administrative</option>
                    <option value="Medical appointment">Rendez-vous médical</option>
                    <option value="Family reason">Raison familiale</option>
                    <option value="Other">Autre</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Commentaire (optionnel)</label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 min-h-[80px]"
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
                form="auth-form"
                className="px-4 py-2 text-sm font-medium text-white bg-[#101828] border border-transparent rounded-lg hover:bg-[#1d2939] focus:outline-none focus:ring-2 focus:ring-gray-900/20"
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
