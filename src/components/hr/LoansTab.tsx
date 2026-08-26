import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useAuth } from '../../context/AuthContext';
import { Plus, X, Wallet, CheckCircle2, Ban } from 'lucide-react';

interface Loan {
  id: number;
  userId: number;
  userName?: string;
  amount: number;
  monthlyDeduction: number;
  amountRepaid: number;
  reason: string;
  dateGranted: string;
  status: 'ACTIVE' | 'REPAID' | 'CANCELLED';
  notes: string;
}

const money = (v: number) => `${(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

/**
 * Gestion des prêts — employer-managed records, not a collaborator-initiated
 * request/approval workflow like leaves/absences: someone with
 * MANAGE_LOANS_ADVANCES grants a loan to any employee and logs repayments
 * against it; everyone else with VIEW_HR sees only their own.
 */
export const LoansTab: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const canManage = hasPermission('MANAGE_LOANS_ADVANCES');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string; role: string }[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [repayModalId, setRepayModalId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState<number | ''>('');

  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [monthlyDeduction, setMonthlyDeduction] = useState<number | ''>('');
  const [dateGranted, setDateGranted] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');

  useEscapeToClose(() => setIsCreating(false), isCreating);
  useEscapeToClose(() => { setRepayModalId(null); setRepayAmount(''); }, !!repayModalId);

  const fetchLoans = () => {
    fetch('/api/hr/loans', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setLoans(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    if (!token) return;
    fetchLoans();
    if (canManage) {
      fetch('/api/hr/employees', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setEmployees(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [token, canManage]);

  const resetForm = () => {
    setEmployeeId(''); setAmount(''); setMonthlyDeduction('');
    setDateGranted(new Date().toISOString().slice(0, 10)); setReason('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !amount || Number(amount) <= 0) return;
    try {
      const res = await fetch('/api/hr/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: employeeId, amount, monthlyDeduction: monthlyDeduction || 0, dateGranted, reason }),
      });
      if (res.ok) { setIsCreating(false); resetForm(); fetchLoans(); }
    } catch { /* ignore */ }
  };

  const handleRepay = async (id: number) => {
    const loan = loans.find(l => l.id === id);
    if (!loan || !repayAmount || Number(repayAmount) <= 0) return;
    try {
      const res = await fetch(`/api/hr/loans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amountRepaid: loan.amountRepaid + Number(repayAmount) }),
      });
      if (res.ok) { setRepayModalId(null); setRepayAmount(''); fetchLoans(); }
    } catch { /* ignore */ }
  };

  const handleCancel = async (id: number) => {
    if (!confirm('Annuler ce prêt ?')) return;
    await fetch(`/api/hr/loans/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });
    fetchLoans();
  };

  const badge = (status: Loan['status']) => {
    if (status === 'ACTIVE') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700"><Wallet className="w-3.5 h-3.5" /> En cours</span>;
    if (status === 'REPAID') return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Remboursé</span>;
    return <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600"><Ban className="w-3.5 h-3.5" /> Annulé</span>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Prêts</h2>
        {canManage && (
          <button
            onClick={() => setIsCreating(true)}
            className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-navy-hover transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nouveau prêt
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
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Mensualité</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Remboursé</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Reste</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loans.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 8 : 7} className="px-6 py-8 text-center text-sm text-gray-500">Aucun prêt trouvé.</td>
              </tr>
            ) : (
              loans.map(loan => (
                <tr key={loan.id} className="hover:bg-gray-50">
                  {canManage && <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{loan.userName}</td>}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{loan.dateGranted}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-mono text-gray-900">{money(loan.amount)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-mono text-gray-500">{money(loan.monthlyDeduction)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-mono text-gray-500">{money(loan.amountRepaid)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-mono font-semibold text-gray-900">{money(Math.max(0, loan.amount - loan.amountRepaid))}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{badge(loan.status)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {canManage && loan.status === 'ACTIVE' && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setRepayModalId(loan.id)}
                          className="text-emerald-600 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium"
                        >
                          Enregistrer un remboursement
                        </button>
                        <button
                          onClick={() => handleCancel(loan.id)}
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

      {/* Repayment modal */}
      {repayModalId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Enregistrer un remboursement</h3>
              <label className="block text-sm font-medium text-gray-700 mb-1">Montant remboursé (DT)</label>
              <input
                type="number" step="0.001" min="0"
                value={repayAmount}
                onChange={e => setRepayAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                autoFocus
              />
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => { setRepayModalId(null); setRepayAmount(''); }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Annuler</button>
                <button
                  onClick={() => handleRepay(repayModalId)}
                  disabled={!repayAmount || Number(repayAmount) <= 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Creation modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Nouveau prêt</h2>
              <button onClick={() => setIsCreating(false)} className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="loan-form" onSubmit={handleSubmit} className="space-y-4">
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
                <div className="grid grid-cols-2 gap-4">
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mensualité (DT)</label>
                    <input
                      type="number" step="0.001" min="0"
                      value={monthlyDeduction}
                      onChange={e => setMonthlyDeduction(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    />
                  </div>
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
              <button type="submit" form="loan-form" className="px-4 py-2 text-sm font-medium text-white bg-navy border border-transparent rounded-lg hover:bg-navy-hover">Créer le prêt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
