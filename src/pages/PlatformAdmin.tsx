import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Phone, Mail, Send, CheckCircle2, Landmark, Pencil, Trash2, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { friendlyError } from '../utils/errors';
import { PlatformUsersModal } from '../components/platform/PlatformUsersModal';
import { CompanyEditModal } from '../components/platform/CompanyEditModal';
import { usePeriodPage, PeriodFilter, PaginationBar } from '../components/PeriodPager';
import { SELLABLE_PLANS, planMeta, planLabel, formatDT, discountedPriceDT } from '../constants/plans';

interface Company {
  id: string;
  secteur?: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  /** Un identifiant d'offre de [plans.ts](../constants/plans.ts) — offres retirées comprises. */
  plan: string;
  seatLimit: number;
  portalSeatLimit?: number;
  createdAt: string;
  trialEndsAt: string | null;
  /** Mois offerts gagnés par parrainage et pas encore appliqués à une échéance. */
  referralCreditMonths?: number;
  /** Remise de bienvenue obtenue par un lien de parrainage… */
  referralDiscountPercent?: number;
  /** …consommée à la première confirmation de paiement, jamais deux fois. */
  referralDiscountUsedAt?: string | null;
  referredByCompanyId?: string | null;
  /** Prix retenu à la confirmation, remise déduite — figé pour ne pas bouger avec le catalogue. */
  subscriptionPriceDT?: number;
  /** Échéance de l'abonnement — indicative : rien ne se ferme quand elle passe. */
  subscriptionEndsAt?: string | null;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  ribSentAt?: string;
  pendingPlan?: string;
}

/** La remise encore due à une entreprise : 10 % de parrainage, tant qu'elle n'a pas souscrit. */
const pendingDiscount = (c: Company): number =>
  c.referredByCompanyId && !c.referralDiscountUsedAt ? Number(c.referralDiscountPercent) || 0 : 0;
const STATUS_STYLE: Record<string, string> = {
  TRIAL: 'bg-run-bg text-run-fg',
  ACTIVE: 'bg-done-bg text-done-fg',
  EXPIRED: 'bg-late-bg text-late-fg',
  SUSPENDED: 'bg-gray-100 text-gray-500',
};
const STATUS_LABELS: Record<string, string> = { TRIAL: 'Essai', ACTIVE: 'Actif', EXPIRED: 'Expiré', SUSPENDED: 'Suspendu' };

/**
 * Dix lignes par page, comme les onglets RH et le Brouillard de caisse : la
 * console plateforme n'a aucune raison de compter autrement que le reste de
 * l'app.
 */
const PLATFORM_PAGE_SIZE = 10;

/** JJ/MM/AAAA, ou « — » : une console se lit en diagonale, pas en anglais. */
const fdate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

const daysLeft = (iso: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
};

/**
 * L'échéance d'une entreprise : la fin d'essai tant que rien n'est payé, la
 * fin de l'abonnement ensuite. Une seule définition, lue par la colonne *et*
 * par le filtre — deux copies finiraient par ne plus désigner la même date.
 */
const dueDateOf = (c: Company): string | null =>
  (c.status === 'TRIAL' ? c.trialEndsAt : c.subscriptionEndsAt) || null;

/**
 * Une échéance qui manque là où il en faut une. Elle se saisit **à la main**
 * depuis la fiche (la facturation vit hors de l'app), donc un compte actif
 * sans date n'est pas un compte sans échéance : c'est une date que personne
 * n'a encore entrée. Un tiret muet le laissait passer inaperçu, et c'est
 * exactement la ligne qu'il faut retrouver pour relancer.
 *
 * Un compte expiré ou suspendu en est exclu : il n'y a rien à y échoir.
 */
const needsDueDate = (c: Company) => (c.status === 'TRIAL' || c.status === 'ACTIVE') && !dueDateOf(c);

export const PlatformAdmin: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planPick, setPlanPick] = useState<Record<string, string>>({});

  /** Recherche libre (nom, contact, e-mail, téléphone, secteur) et statut. */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  /** Échéance : '' (toutes), 'MISSING' (à saisir), 'OVERDUE' (passée), 'SOON' (sous 30 j). */
  const [dueFilter, setDueFilter] = useState('');

  const [usersCompany, setUsersCompany] = useState<Company | null>(null);
  const [editCompany, setEditCompany] = useState<Company | null>(null);
  /** Le bouton Supprimer de la ligne ouvre la fiche directement sur sa zone de suppression. */
  const [openDelete, setOpenDelete] = useState(false);

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

  // Recherche et statut d'abord, période ensuite : c'est le pager qui découpe
  // en pages, donc il doit recevoir des lignes déjà filtrées — sinon son
  // décompte « X à Y sur Z » compterait des entreprises que le tableau ne
  // montre pas.
  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter(c => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (dueFilter) {
        const left = daysLeft(dueDateOf(c));
        if (dueFilter === 'MISSING' && !needsDueDate(c)) return false;
        if (dueFilter === 'OVERDUE' && (left === null || left >= 0)) return false;
        if (dueFilter === 'SOON' && (left === null || left < 0 || left > 30)) return false;
      }
      if (!q) return true;
      return [c.name, c.contactName, c.contactEmail, c.phone, c.secteur]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [companies, search, statusFilter, dueFilter]);

  // `createdAt` est la seule date que porte une entreprise : le filtre année
  // puis mois — le même geste que partout ailleurs — porte donc sur son
  // inscription, ce que dit le libellé à côté des deux listes.
  const companyDate = useCallback((c: Company) => c.createdAt, []);
  const pager = usePeriodPage<Company>(matching, companyDate, PLATFORM_PAGE_SIZE);

  // Le pager ne revient de lui-même en page 1 que si la page courante dépasse
  // le nouveau total. Restreindre par recherche ou par statut peut laisser
  // assez de pages pour que la page 3 existe encore tout en n'étant plus celle
  // qu'on regardait : on repart du début, comme le font les listes déroulantes
  // de période.
  useEffect(() => { pager.setPage(1); }, [search, statusFilter, dueFilter]);

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
    if (!confirm(`Confirmer le paiement de "${c.name}" pour l'offre ${planLabel(planFor(c))} ?`)) return;
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
    <main className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1400px] w-full mx-auto">
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
          <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher : entreprise, contact, e-mail, téléphone…"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-[12.5px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-navy/20"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              title="Filtrer par statut"
              className="bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-navy/20 cursor-pointer"
            >
              <option value="">Tous les statuts</option>
              {Object.entries(STATUS_LABELS).map(([value, labelText]) => (
                <option key={value} value={value}>{labelText}</option>
              ))}
            </select>
            {/* L'échéance se saisit à la main : ce filtre est ce qui rend
                « lesquelles restent à saisir » et « lesquelles sont passées »
                consultables sans parcourir toutes les pages. */}
            <select
              value={dueFilter}
              onChange={e => setDueFilter(e.target.value)}
              title="Filtrer par échéance"
              className="bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-navy/20 cursor-pointer"
            >
              <option value="">Toutes les échéances</option>
              <option value="MISSING">Échéance à saisir</option>
              <option value="OVERDUE">Échéance passée</option>
              <option value="SOON">Échéance sous 30 jours</option>
            </select>
            {/* Les deux listes de période portent sur la date d'inscription —
                le libellé le dit, « Toutes les années » seul ne dirait pas de
                quelle date il parle. */}
            <span className="text-[11.5px] text-gray-400 shrink-0">Inscrite&nbsp;:</span>
            <PeriodFilter page={pager} />
          </div>
          {/* Sept colonnes ne tiennent plus sur un portable : le tableau défile
              dans son propre conteneur plutôt que de rogner les actions à
              droite — la page, elle, ne défile jamais horizontalement. */}
          <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[980px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Entreprise</th>
                <th className="text-left px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Contact</th>
                <th className="text-left px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Statut</th>
                <th className="text-left px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Inscription</th>
                <th className="text-left px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Échéance</th>
                <th className="text-left px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Offre</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageRows.map(c => {
                const remaining = daysLeft(c.trialEndsAt);
                return (
                  <tr key={c.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-gray-800">{c.name}</div>
                      {c.status === 'TRIAL' && remaining !== null && (
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {remaining >= 0 ? `${remaining} j restant(s)` : 'Essai terminé'}
                        </div>
                      )}
                      {/* Parrainage : pour une entreprise déjà active il n'y a
                          pas de date d'essai à repousser, la récompense est un
                          avoir. Il doit se voir ici, sinon personne ne
                          l'applique et le mois promis n'existe jamais. */}
                      {!!c.referralCreditMonths && (
                        <div className="text-[11px] text-emerald-700 font-medium mt-0.5">
                          {c.referralCreditMonths} mois offert(s) à déduire
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-gray-700">{c.contactName}</div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400">
                        {c.contactEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.contactEmail}</span>}
                        {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${STATUS_STYLE[c.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABELS[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700" title="Date de création du compte">
                      {fdate(c.createdAt)}
                    </td>
                    {/* L'échéance : la fin d'essai tant que rien n'est payé,
                        la fin de l'abonnement ensuite. Une date dépassée est
                        signalée en rouge et **rien d'autre** — la fermeture
                        d'un accès reste une décision prise à la main, par le
                        bouton de la fiche. */}
                    <td className="px-3 py-3 whitespace-nowrap">{(() => {
                      const due = dueDateOf(c);
                      const left = daysLeft(due);
                      if (!due) {
                        return needsDueDate(c) ? (
                          <span
                            className="text-[11.5px] font-semibold text-[#B54708] bg-[#FFFAEB] px-2 py-0.5 rounded-full"
                            title="Aucune échéance enregistrée — elle se saisit à la main dans la fiche (bouton Modifier)."
                          >
                            À définir
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        );
                      }
                      const over = left !== null && left < 0;
                      return (
                        <div title={c.status === 'TRIAL' ? "Fin de la période d'essai" : "Fin de l'abonnement en cours — à repousser à chaque règlement"}>
                          <div className={over ? 'text-red-600 font-semibold' : 'text-gray-700'}>{fdate(due)}</div>
                          <div className={`text-[11px] ${over ? 'text-red-500' : 'text-gray-400'}`}>
                            {left === null ? '' : over ? `échue depuis ${-left} j` : `${left} j restant(s)`}
                          </div>
                        </div>
                      );
                    })()}</td>
                    <td className="px-3 py-3">
                      <select
                        value={planFor(c)}
                        onChange={e => setPlanPick({ ...planPick, [c.id]: e.target.value })}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-[12px] bg-white"
                        disabled={c.status === 'ACTIVE'}
                      >
                        {/* Une entreprise encore sur une offre retirée garde
                            son option, sinon le <select> afficherait la
                            première offre du catalogue comme si c'était la
                            sienne. Elle ne peut pas y revenir une fois
                            changée : elle n'est pas dans la liste vendue. */}
                        {!planMeta(planFor(c))?.legacy ? null : (
                          <option value={planFor(c)}>{planLabel(planFor(c))}</option>
                        )}
                        {SELLABLE_PLANS.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.label} — {formatDT(p.priceDT)}/mois
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const meta = planMeta(planFor(c));
                        if (!meta) return null;
                        const discount = pendingDiscount(c);
                        return (
                          <div className="text-[11px] text-gray-400 mt-1">
                            {meta.seatLimit} util. + {meta.portalSeatLimit} portail
                            {/* Le prix à encaisser, remise de parrainage
                                déduite : c'est ce chiffre-là qu'il faut
                                facturer, pas celui du catalogue. */}
                            {discount > 0 && (
                              <div className="text-emerald-700 font-medium">
                                {formatDT(discountedPriceDT(meta.priceDT, discount))}/mois — remise parrainage −{discount} %
                              </div>
                            )}
                            {c.status === 'ACTIVE' && c.subscriptionPriceDT !== undefined && (
                              <div className="text-gray-500">Facturé {formatDT(c.subscriptionPriceDT)}/mois</div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {/* Modifier ouvre la fiche complète — les utilisateurs
                            de l'entreprise s'y gèrent aussi, l'action n'a pas
                            disparu avec le bouton qui était ici. Supprimer
                            passe par la même fiche : la confirmation par nom
                            exact ne tient pas dans une ligne de tableau. */}
                        <button
                          onClick={() => setEditCompany(c)}
                          title="Modifier l'entreprise"
                          className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-[11.5px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Modifier
                        </button>
                        <button
                          onClick={() => { setEditCompany(c); setOpenDelete(true); }}
                          title="Supprimer l'entreprise et toutes ses données"
                          className="px-2.5 py-1.5 border border-red-200 rounded-lg text-[11.5px] font-medium text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Supprimer
                        </button>
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
              {pager.pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-gray-500">
                    Aucune entreprise ne correspond à ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          <div className="px-4 pb-4">
            <PaginationBar page={pager} unit="entreprises" />
          </div>
        </div>
      )}

      {editCompany && (
        <CompanyEditModal
          company={editCompany as any}
          startInDeleteMode={openDelete}
          onClose={() => { setEditCompany(null); setOpenDelete(false); load(); }}
          onSaved={() => { setEditCompany(null); setOpenDelete(false); load(); }}
          onDeleted={() => { setEditCompany(null); setOpenDelete(false); load(); }}
          onManageUsers={() => { setUsersCompany(editCompany); setEditCompany(null); setOpenDelete(false); }}
        />
      )}

      {usersCompany && (
        <PlatformUsersModal
          companyId={usersCompany.id}
          companyName={usersCompany.name}
          onClose={() => setUsersCompany(null)}
        />
      )}
    </main>
  );
};
