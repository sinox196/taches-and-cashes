import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useAuth } from '../../context/AuthContext';
import { Plus, X, Wallet, CheckCircle2, Ban } from 'lucide-react';

interface Advance {
  id: number;
  userId: number;
  userName?: string;
  amount: number;
  reason: string;
  dateGranted: string;
  status: 'ACTIVE' | 'REPAID' | 'CANCELLED';
  notes: string;
}

const money = (v: number) => `${(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

/**
 * Gestion des avances — a single lump-sum advance on salary, simpler than a
 * loan (no schedule/instalments): granted, then later marked repaid once
 * recovered from payroll. Same employer-managed model as LoansTab.
 */
export const AdvancesTab: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const canManage = hasPermission('MANAGE_LOANS_ADVANCES');
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string; role: string }[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [dateGranted, setDateGranted] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');

  useEscapeToClose(() => setIsCreating(false), isCreating);

  const fetchAdvances = () => {
    fetch('/api/hr/advances', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAdvances(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    if (!token) return;
    fetchAdvances();
    if (canManage) {
      fetch('/api/hr/employees', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setEmployees(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [token, canManage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !amount || Number(amount) <= 0) return;
    try {
      const res = await fetch('/api/hr/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: employeeId, amount, dateGranted, reason }),
      });
      if (res.ok) {
        setIsCreating(false);
        setEmployeeId(''); setAmount(''); setDateGranted(new Date().toISOString().slice(0, 10)); setReason('');
        fetchAdvances();
      }
    } catch { /* ignore */ }
  };

  const setStatus = async (id: number, status: Advance['status']) => {
    if (status === 'CANCELLED' && !confirm('Annuler cette avance ?')) return;
    await fetch(`/api/hr/advances/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    fetchAdvances();
  };

  const badge = (status: Advance['status']) => {
    if (status === 'ACTIVE') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700"><Wallet className="w-3.5 h-3.5" /> En cours</span>;
    if (status === 'REPAID') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Remboursée</span>;
    return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600"><Ban className="w-3.5 h-3.5" /> Annulée</span>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Avances</h2>
        {canManage && (
          <button
            onClick={() => setIsCreating(true)}
            className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-navy-hover transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nouvelle avance
          </button>
        )}
      </div>

      <div className="overflow-x-auto flex-1 border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {canManage && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employé</th>}
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
                <td colSpan={canManage ? 6 : 5} className="px-6 py-8 text-center text-sm text-gray-500">Aucune avance trouvée.</td>
              </tr>
            ) : (
              advances.map(adv => (
                <tr key={adv.id} className="hover:bg-gray-50">
                  {canManage && <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{adv.userName}</td>}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{adv.dateGranted}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-mono text-gray-900">{money(adv.amount)}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate" title={adv.reason}>{adv.reason || '—'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{badge(adv.status)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {canManage && adv.status === 'ACTIVE' && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setStatus(adv.id, 'REPAID')}
                          className="text-emerald-600 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium"
                        >
                          Marquer remboursée
                        </button>
                        <button
                          onClick={() => setStatus(adv.id, 'CANCELLED')}
                          className="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-1.5 rounded-md transition-colors"
                          title="Annuler"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isCreating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Nouvelle avance</h2>
              <button onClick={() => setIsCreating(false)} className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="advance-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Employé</label>
                  <select
                    value={employeeId}
                    onChange={e => setEmployeeId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  >
                    <option value="" disabled>Sélectionner un employé</option>
                    {employees.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date d'octroi</label>
                  <input
                    type="date"
                    value={dateGranted}
                    onChange={e => setDateGranted(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  />
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
              <button type="submit" form="advance-form" className="px-4 py-2 text-sm font-medium text-white bg-navy border border-transparent rounded-lg hover:bg-navy-hover">Créer l'avance</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
