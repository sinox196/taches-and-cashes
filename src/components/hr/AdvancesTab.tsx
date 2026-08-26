import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useAuth } from '../../context/AuthContext';
import { Plus, X, Check, Wallet, CheckCircle2, Ban, Clock, AlertCircle } from 'lucide-react';

interface Advance {
  id: number;
  userId: number;
  userName?: string;
  approverId: number;
  approverName?: string;
  amount: number;
  reason: string;
  dateGranted: string;
  status: 'PENDING' | 'ACTIVE' | 'REPAID' | 'REJECTED' | 'CANCELLED';
  approverComment?: string;
}

const money = (v: number) => `${(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

/**
 * Gestion des avances — same collaborator-initiated request/approval
 * workflow as LoansTab, just a single lump sum instead of a schedule: the
 * requester picks a responsable, who is notified and must approve or
 * reject before the advance becomes active.
 */
export const AdvancesTab: React.FC = () => {
  const { token, hasPermission, user } = useAuth();
  const canManage = hasPermission('MANAGE_LOANS_ADVANCES');
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [approvers, setApprovers] = useState<{ id: number; name: string; role: string }[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const [amount, setAmount] = useState<number | ''>('');
  const [dateGranted, setDateGranted] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');

  const [approvalModalId, setApprovalModalId] = useState<number | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [rejectionModalId, setRejectionModalId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  useEscapeToClose(() => setIsCreating(false), isCreating);
  useEscapeToClose(() => { setApprovalModalId(null); setApprovalComment(''); }, !!approvalModalId);
  useEscapeToClose(() => { setRejectionModalId(null); setRejectionReason(''); }, !!rejectionModalId);

  const fetchAdvances = () => {
    fetch('/api/hr/advances', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAdvances(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const fetchApprovers = () => {
    fetch('/api/hr/approvers', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setApprovers(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    if (!token) return;
    fetchAdvances();
    fetchApprovers();
  }, [token]);

  const resetForm = () => {
    setAmount(''); setDateGranted(new Date().toISOString().slice(0, 10)); setReason(''); setApproverId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approverId || !amount || Number(amount) <= 0) return;
    try {
      const res = await fetch('/api/hr/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount, dateGranted, reason, approverId }),
      });
      if (res.ok) { setIsCreating(false); resetForm(); fetchAdvances(); }
    } catch { /* ignore */ }
  };

  const handleApprove = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/advances/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ comment: approvalComment }),
      });
      if (res.ok) { setApprovalModalId(null); setApprovalComment(''); fetchAdvances(); }
      else { const err = await res.json(); alert(err.error || 'Failed to approve'); }
    } catch { /* ignore */ }
  };

  const handleReject = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/advances/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ comment: rejectionReason }),
      });
      if (res.ok) { setRejectionModalId(null); setRejectionReason(''); fetchAdvances(); }
      else { const err = await res.json(); alert(err.error || 'Failed to reject'); }
    } catch { /* ignore */ }
  };

  const handleCancel = async (id: number) => {
    if (!confirm('Voulez-vous vraiment annuler cette demande ?')) return;
    try {
      const res = await fetch(`/api/hr/advances/${id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchAdvances();
      else { const err = await res.json(); alert(err.error || 'Failed to cancel'); }
    } catch { /* ignore */ }
  };

  const markRepaid = async (id: number) => {
    await fetch(`/api/hr/advances/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    fetchAdvances();
  };

  const badge = (status: Advance['status']) => {
    if (status === 'PENDING') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700"><Clock className="w-3.5 h-3.5" /> En attente</span>;
    if (status === 'ACTIVE') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700"><Wallet className="w-3.5 h-3.5" /> En cours</span>;
    if (status === 'REPAID') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Remboursée</span>;
    if (status === 'REJECTED') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700"><X className="w-3.5 h-3.5" /> Refusée</span>;
    return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600"><Ban className="w-3.5 h-3.5" /> Annulée</span>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Avances</h2>
        {hasPermission('CREATE_LOAN_REQUEST') && (
          <button
            onClick={() => setIsCreating(true)}
            className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-navy-hover transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Demander une avance
          </button>
        )}
      </div>

      <div className="overflow-x-auto flex-1 border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {canManage && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employé</th>}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Responsable</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Montant</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Motif</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {advances.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-6 py-8 text-center text-sm text-gray-500">Aucune avance trouvée.</td>
              </tr>
            ) : (
              advances.map(adv => (
                <tr key={adv.id} className="hover:bg-gray-50">
                  {canManage && <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{adv.userName}</td>}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{adv.approverName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{adv.dateGranted}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-mono text-gray-900">{money(adv.amount)}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate" title={adv.reason}>{adv.reason || '—'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {badge(adv.status)}
                    {(adv.status === 'REJECTED' || adv.status === 'ACTIVE' || adv.status === 'REPAID') && adv.approverComment && (
                      <p className="text-[10px] text-gray-500 mt-1 max-w-[150px] truncate" title={adv.approverComment}>
                        Commentaire: {adv.approverComment}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      {canManage && (user?.role === 'ADMIN' || user?.id === adv.approverId) && adv.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => setApprovalModalId(adv.id)}
                            className="text-emerald-600 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 p-1.5 rounded-md transition-colors"
                            title="Approuver"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRejectionModalId(adv.id)}
                            className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-1.5 rounded-md transition-colors"
                            title="Refuser"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {canManage && adv.status === 'ACTIVE' && (
                        <button
                          onClick={() => markRepaid(adv.id)}
                          className="text-emerald-600 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium"
                        >
                          Marquer remboursée
                        </button>
                      )}
                      {(adv.status === 'PENDING' || adv.status === 'ACTIVE') && (
                        <button
                          onClick={() => handleCancel(adv.id)}
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

      {/* Approval modal */}
      {approvalModalId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Approuver la demande d'avance</h3>
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

      {/* Rejection modal */}
      {rejectionModalId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Refuser la demande d'avance</h3>
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

      {isCreating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Demander une avance</h2>
              <button onClick={() => setIsCreating(false)} className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="advance-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Montant (DT)</label>
                  <input
                    type="number" step="0.001" min="0"
                    value={amount}
                    onChange={e => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date souhaitée</label>
                  <input
                    type="date"
                    value={dateGranted}
                    onChange={e => setDateGranted(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  />
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
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motif (optionnel)</label>
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 min-h-[70px]"
                  />
                </div>
              </form>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button type="button" onClick={() => setIsCreating(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Annuler</button>
              <button type="submit" form="advance-form" className="px-4 py-2 text-sm font-medium text-white bg-navy border border-transparent rounded-lg hover:bg-navy-hover">Soumettre</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
