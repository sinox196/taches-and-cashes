import React, { useState } from 'react';
import { X, Loader2, Mail, CheckCircle2, Lock, User, Phone, Building2 } from 'lucide-react';
import { friendlyError } from '../../utils/errors';
import { useAuth } from '../../context/AuthContext';

interface RequestAccessModalProps {
  plan: string;
  onClose: () => void;
}

const PLAN_CODES: Record<string, string> = {
  Freelance: 'FREELANCE',
  Équipe: 'EQUIPE',
  Croissance: 'CROISSANCE',
};

/**
 * Two different flows behind one modal, picked by which pricing card was
 * clicked:
 *
 * - The three standard packs (Freelance/Équipe/Croissance) are a real
 *   signup — POST /api/signup provisions an isolated company immediately
 *   (TRIAL, full feature access, free for the trial period) and logs the
 *   visitor straight in. No payment happens here; converting to a paid plan
 *   is a platform-admin action later, after a sales call, once payment is
 *   manually confirmed.
 * - "Sur mesure" (>10 seats) stays a lead-capture request — a custom deal is
 *   inherently a conversation, not a form. POST /api/orders records it and
 *   notifies contact@taches-and-cash.com.
 */
export const RequestAccessModal: React.FC<RequestAccessModalProps> = ({ plan, onClose }) => {
  const { login } = useAuth();
  const isSignup = plan in PLAN_CODES;

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — real visitors never see this field
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isSignup && password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setSending(true);
    try {
      if (isSignup) {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName, contactName, contactEmail, phone, username, password, confirmPassword,
            plan: PLAN_CODES[plan], website,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || 'Une erreur est survenue.');
          return;
        }
        login(data.token, data.user);
        setSignedUp(true);
      } else {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: contactName, email: contactEmail, company: companyName, plan, message, website }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || 'Une erreur est survenue.');
          return;
        }
        setReference(data.reference);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSending(false);
    }
  };

  // Signup succeeded: login() has already switched the app into the
  // authenticated shell behind this modal, so there is nothing left to show
  // here — closing it reveals the real app immediately.
  if (signedUp) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-[16px] font-bold text-navy">
            {reference ? 'Demande envoyée' : isSignup ? `Créer votre compte — ${plan}` : `Demande d'accès — ${plan}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {reference ? (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-turquoise/10 text-turquoise flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <p className="text-[14.5px] font-semibold text-gray-900 mb-1.5">Merci pour votre intérêt !</p>
            <p className="text-[13.5px] text-gray-600 leading-relaxed">
              Nous vous recontactons sous 24–48h pour établir une offre sur mesure.
            </p>
            <p className="mt-3 text-[12px] text-gray-400">
              Référence : <span className="font-mono font-semibold text-gray-600">{reference}</span>
            </p>
            <button
              onClick={onClose}
              className="mt-6 px-5 py-2.5 bg-navy text-white rounded-lg text-[13.5px] font-semibold hover:bg-navy-hover"
            >
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
            {isSignup && (
              <p className="text-[12.5px] text-gray-500 bg-canvas rounded-lg px-3 py-2.5 leading-relaxed">
                Accès complet et gratuit pendant votre période d'essai — aucune carte bancaire requise. Nous vous
                appellerons pour choisir votre offre définitive.
              </p>
            )}

            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-md">
                <p className="text-[12.5px] text-red-700 font-medium">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Nom</label>
              <input
                required
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="Votre nom"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Email</label>
              <input
                required
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="vous@entreprise.com"
              />
            </div>

            {isSignup && (
              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Téléphone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    required
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    placeholder="+216 XX XXX XXX"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Entreprise</label>
              <div className="relative">
                {isSignup && <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
                <input
                  required
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className={`w-full py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent ${isSignup ? 'pl-9 pr-3' : 'px-3'}`}
                  placeholder="Nom de votre cabinet / entreprise"
                />
              </div>
            </div>

            {isSignup ? (
              <>
                <div>
                  <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Nom d'utilisateur</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      required
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                      placeholder="Identifiant de connexion"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Mot de passe</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      required
                      type="password"
                      minLength={6}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                      placeholder="6 caractères minimum"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Confirmer le mot de passe</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      required
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                      placeholder="Retapez le mot de passe"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Message (facultatif)</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
                  placeholder="Nombre d'utilisateurs, besoins particuliers…"
                />
              </div>
            )}

            {/* Honeypot: hidden from real visitors via CSS, off-screen — a bot that fills every field fills this one too. */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13.5px] font-bold text-white bg-navy hover:bg-navy-hover disabled:opacity-70 transition-colors"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {isSignup ? 'Créer mon compte' : 'Envoyer ma demande'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
