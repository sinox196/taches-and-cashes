import React, { useState } from 'react';
import { Loader2, X, Users, Trash2, AlertTriangle, Power } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';

interface Company {
  id: string;
  name: string;
  status: string;
  plan: string;
  seatLimit: number;
  portalSeatLimit?: number;
  trialEndsAt: string | null;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  secteur?: string;
}

interface Props {
  company: Company;
  onClose: () => void;
  /** Ouvre directement la zone de suppression, depuis le bouton de la ligne. */
  startInDeleteMode?: boolean;
  onSaved: () => void;
  onDeleted: () => void;
  /** Ouvre la gestion des utilisateurs de cette entreprise. */
  onManageUsers: () => void;
}

/**
 * Modifier une entreprise depuis la console plateforme.
 *
 * `status` et `plan` n'y figurent pas : ils se changent par la confirmation de
 * paiement, qui porte ses propres effets de bord. Les rendre modifiables ici
 * ouvrirait un second chemin capable d'activer un compte sans paiement — le
 * serveur les refuse aussi, ce formulaire n'est pas la seule barrière.
 */
export const CompanyEditModal: React.FC<Props> = ({ company, onClose, onSaved, onDeleted, onManageUsers, startInDeleteMode = false }) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [name, setName] = useState(company.name || '');
  const [contactName, setContactName] = useState(company.contactName || '');
  const [contactEmail, setContactEmail] = useState(company.contactEmail || '');
  const [phone, setPhone] = useState(company.phone || '');
  const [seatLimit, setSeatLimit] = useState<string>(String(company.seatLimit ?? ''));
  const [portalSeatLimit, setPortalSeatLimit] = useState<string>(String(company.portalSeatLimit ?? ''));
  const [trialEndsAt, setTrialEndsAt] = useState((company.trialEndsAt || '').slice(0, 10));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /** Deux temps pour la suppression : ouvrir la zone, puis retaper le nom. */
  const [confirmingDelete, setConfirmingDelete] = useState(startInDeleteMode);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  /**
   * L'accès se pilote par une route à part, pas par le formulaire : suspendre
   * est une décision d'exploitation, et réactiver ne doit jamais pouvoir créer
   * un abonnement payé. Le serveur restaure le statut d'avant la suspension.
   */
  const [status, setStatus] = useState(company.status);
  const [togglingAccess, setTogglingAccess] = useState(false);
  const suspended = status === 'SUSPENDED';

  const toggleAccess = async () => {
    setError('');
    setTogglingAccess(true);
    try {
      const res = await fetch(`/api/platform/companies/${company.id}/access`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ active: suspended }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setStatus((await res.json()).status);
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setTogglingAccess(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/companies/${company.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ name, contactName, contactEmail, phone, seatLimit, portalSeatLimit, trialEndsAt }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      onSaved();
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError('');
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/platform/companies/${company.id}?confirmName=${encodeURIComponent(confirmName)}`,
        { method: 'DELETE', headers: authHeaders },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      onDeleted();
    } catch (err: any) {
      setError(friendlyError(err));
      setDeleting(false);
    }
  };

  const nameMatches = confirmName.trim() === (company.name || '').trim();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <form onSubmit={save} className="bg-white rounded-xl shadow-xl w-full max-w-lg my-auto">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-gray-900 truncate">Modifier l'entreprise</h2>
            <p className="text-[12px] text-gray-500 mt-0.5 truncate">{company.name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">
              Nom de l'entreprise <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">Contact</label>
              <input
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">Téléphone</label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={e => setContactEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">Sièges (back-office)</label>
              <input
                type="number"
                min={1}
                value={seatLimit}
                onChange={e => setSeatLimit(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
              <p className="text-[10.5px] text-gray-400 mt-1">Peut dépasser ce que l'offre donne, si c'est négocié.</p>
            </div>
            {/* Panier séparé : les comptes du portail ne consomment pas les
                sièges de l'équipe, sinon un cabinet avec cinquante clients
                connectés n'aurait plus de place pour ses collaborateurs. */}
            <div>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">Comptes portail client</label>
              <input
                type="number"
                min={0}
                value={portalSeatLimit}
                onChange={e => setPortalSeatLimit(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
              <p className="text-[10.5px] text-gray-400 mt-1">Comptés à part des sièges. 0 = aucun.</p>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">Fin d'essai</label>
              <input
                type="date"
                value={trialEndsAt}
                onChange={e => setTrialEndsAt(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
              <p className="text-[10.5px] text-gray-400 mt-1">Vide = pas de date de fin.</p>
            </div>
          </div>

          {/* Accès au compte. Séparé du reste du formulaire : il ne s'enregistre
              pas avec « Enregistrer », il prend effet au clic. */}
          <div className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${
            suspended ? 'border-late-bg bg-late-bg/40' : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${suspended ? 'bg-late-fg' : 'bg-done-fg'}`} />
                <span className="text-[12.5px] font-semibold text-gray-900">
                  {suspended ? 'Accès suspendu' : 'Compte actif'}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {suspended
                  ? "Personne ne peut se connecter. Les données sont conservées intactes."
                  : "Suspendre ferme la connexion pour tous ses utilisateurs, sans rien supprimer."}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleAccess}
              disabled={togglingAccess}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-50 ${
                suspended
                  ? 'bg-navy text-white hover:bg-navy-hover'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {togglingAccess ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
              {suspended ? 'Réactiver' : 'Suspendre'}
            </button>
          </div>

          {/* La gestion des utilisateurs vit ici depuis que la ligne du tableau
              ne porte plus son propre bouton : l'action n'a pas disparu, elle a
              changé d'endroit. */}
          <button
            type="button"
            onClick={onManageUsers}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <Users className="w-4 h-4" /> Gérer les utilisateurs
          </button>

          {error && (
            <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
              {error}
            </div>
          )}

          {/* Zone de suppression, visuellement séparée du reste du formulaire :
              elle ne partage rien avec l'enregistrement et ne doit pas pouvoir
              être déclenchée par mégarde en validant. */}
          <div className="pt-4 border-t border-gray-100">
            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-2 text-[12.5px] font-medium text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" /> Supprimer cette entreprise
              </button>
            ) : (
              <div className="p-3 rounded-lg border border-red-200 bg-red-50 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-px" />
                  <p className="text-[12px] text-red-900">
                    Supprime définitivement <strong>{company.name}</strong> et <strong>toutes</strong> ses
                    données : utilisateurs, clients, temps pointé, factures, caisse, RH, ressources.
                    Cette action est irréversible et il n'y a pas de corbeille.
                  </p>
                </div>
                <div>
                  <label className="block text-[11.5px] font-semibold text-red-900 mb-1">
                    Retapez le nom exact pour confirmer
                  </label>
                  <input
                    value={confirmName}
                    onChange={e => setConfirmName(e.target.value)}
                    placeholder={company.name}
                    className="w-full px-3 py-2 border border-red-300 rounded-lg text-[13px] bg-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setConfirmingDelete(false); setConfirmName(''); }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={!nameMatches || deleting}
                    className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-[12.5px] font-semibold hover:bg-red-700 disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Supprimer définitivement
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 bg-white hover:bg-gray-100"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-semibold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
};
