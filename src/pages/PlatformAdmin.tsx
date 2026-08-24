import React, { useEffect, useState } from 'react';
import { Loader2, Phone, Mail, Send, CheckCircle2, Landmark } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { friendlyError } from '../utils/errors';

interface Company {
  id: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  plan: 'FREELANCE' | 'EQUIPE' | 'CROISSANCE';
  seatLimit: number;
  createdAt: string;
  trialEndsAt: string | null;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  ribSentAt?: string;
  pendingPlan?: string;
}

const PLAN_LABELS: Record<string, string> = { FREELANCE: 'Freelance', EQUIPE: 'Équipe', CROISSANCE: 'Croissance' };
const STATUS_STYLE: Record<string, string> = {
  TRIAL: 'bg-run-bg text-run-fg',
  ACTIVE: 'bg-done-bg text-done-fg',
  EXPIRED: 'bg-late-bg text-late-fg',
  SUSPENDED: 'bg-gray-100 text-gray-500',
};
const STATUS_LABELS: Record<string, string> = { TRIAL: 'Essai', ACTIVE: 'Actif', EXPIRED: 'Expiré', SUSPENDED: 'Suspendu' };

const daysLeft = (iso: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
};

export const PlatformAdmin: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planPick, setPlanPick] = useState<Record<string, string>>({});

  const [bank, setBank] = useState({ bankName: '', iban: '', rib: '', swift: '', instructions: '' });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankSaved, setBankSaved] = useState(false);
  const [showBank, setShowBank] = useState(false);

  const load = async () => {
    try {
      const [companiesRes, bankRes] = await Promise.all([
        fetch('/api/platform/companies', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/platform/settings', { headers: authHeaders }).then(r => r.json()),
      ]);
      if (Array.isArray(companiesRes)) setCompanies(companiesRes);
      if (bankRes && typeof bankRes === 'object') setBank({ bankName: '', iban: '', rib: '', swift: '', instructions: '', ...bankRes });
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger les entreprises.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const planFor = (c: Company) => planPick[c.id] || c.pendingPlan || c.plan || 'FREELANCE';

  const sendRib = async (c: Company) => {
    setBusyId(c.id);
    setError('');
    try {
      const res = await fetch(`/api/platform/companies/${c.id}/send-rib`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ plan: planFor(c) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Envoi impossible.');
      if (!data.emailSent) throw new Error("L'email n'a pas pu être envoyé (SMTP indisponible ou refusé) — vérifiez la configuration ou envoyez le RIB manuellement.");
      await load();
    } catch (e) {
      setError(friendlyError(e, "Impossible d'envoyer le RIB."));
    } finally {
      setBusyId(null);
    }
  };

  const confirmPayment = async (c: Company) => {
    if (!confirm(`Confirmer le paiement de "${c.name}" pour l'offre ${PLAN_LABELS[planFor(c)]} ?`)) return;
    setBusyId(c.id);
    setError('');
    try {
      const res = await fetch(`/api/platform/companies/${c.id}/confirm`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ plan: planFor(c) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Confirmation impossible.');
      await load();
    } catch (e) {
      setError(friendlyError(e, 'Impossible de confirmer le paiement.'));
    } finally {
      setBusyId(null);
    }
  };

  const saveBank = async () => {
    setBankSaving(true);
    setBankSaved(false);
    setError('');
    try {
      const res = await fetch('/api/platform/settings', { method: 'PUT', headers: authHeaders, body: JSON.stringify(bank) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      setBank(data);
      setBankSaved(true);
      setTimeout(() => setBankSaved(false), 2000);
    } catch (e) {
      setError(friendlyError(e, 'Impossible d\'enregistrer les coordonnées.'));
    } finally {
      setBankSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <main className="p-6 lg:p-8 flex-1 flex flex-col space-y-6 max-w-[1200px] w-full mx-auto">
      <div>
        <h1 className="text-[19px] font-extrabold text-gray-800 tracking-tight">Plateforme — entreprises clientes</h1>
        <p className="text-[11.5px] text-gray-500 mt-0.5">
          Essais gratuits, envoi des coordonnées bancaires, confirmation manuelle des paiements.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <button
          onClick={() => setShowBank(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-[13px] font-bold text-navy"
        >
          <span className="flex items-center gap-2"><Landmark className="w-4 h-4" /> Coordonnées bancaires (RIB envoyé aux clients)</span>
          <span className="text-gray-400 text-[12px] font-medium">{showBank ? 'Masquer' : 'Afficher'}</span>
        </button>
        {showBank && (
          <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-100 pt-4">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Banque</label>
              <input value={bank.bankName} onChange={e => setBank({ ...bank, bankName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">RIB</label>
              <input value={bank.rib} onChange={e => setBank({ ...bank, rib: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">IBAN</label>
              <input value={bank.iban} onChange={e => setBank({ ...bank, iban: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">SWIFT</label>
              <input value={bank.swift} onChange={e => setBank({ ...bank, swift: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Instructions (facultatif)</label>
              <textarea value={bank.instructions} onChange={e => setBank({ ...bank, instructions: e.target.value })}
                rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] resize-none" />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                onClick={saveBank}
                disabled={bankSaving}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[12.5px] font-semibold hover:bg-navy-hover disabled:opacity-60 flex items-center gap-2"
              >
                {bankSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : bankSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                {bankSaved ? 'Enregistré' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </div>

      {companies.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <p className="text-[13px] text-gray-500">Aucune entreprise pour le moment.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Entreprise</th>
                <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Contact</th>
                <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Statut</th>
                <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Offre</th>
                <th className="text-right px-4 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(c => {
                const remaining = daysLeft(c.trialEndsAt);
                return (
                  <tr key={c.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-800">{c.name}</div>
                      {c.status === 'TRIAL' && remaining !== null && (
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {remaining >= 0 ? `${remaining} j restant(s)` : 'Essai terminé'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-700">{c.contactName}</div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400">
                        {c.contactEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.contactEmail}</span>}
                        {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${STATUS_STYLE[c.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABELS[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={planFor(c)}
                        onChange={e => setPlanPick({ ...planPick, [c.id]: e.target.value })}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-[12px] bg-white"
                        disabled={c.status === 'ACTIVE'}
                      >
                        <option value="FREELANCE">Freelance</option>
                        <option value="EQUIPE">Équipe</option>
                        <option value="CROISSANCE">Croissance</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {c.status !== 'ACTIVE' && (
                          <>
                            <button
                              onClick={() => sendRib(c)}
                              disabled={busyId === c.id}
                              title="Envoyer le RIB par email"
                              className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-[11.5px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                            >
                              <Send className="w-3.5 h-3.5" /> RIB
                            </button>
                            <button
                              onClick={() => confirmPayment(c)}
                              disabled={busyId === c.id}
                              className="px-2.5 py-1.5 bg-navy text-white rounded-lg text-[11.5px] font-semibold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {busyId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              Confirmer
                            </button>
                          </>
                        )}
                        {c.status === 'ACTIVE' && <span className="text-[11.5px] text-gray-400">Actif</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
};
