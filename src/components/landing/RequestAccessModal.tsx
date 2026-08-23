import React, { useState } from 'react';
import { X, Loader2, Mail, CheckCircle2 } from 'lucide-react';
import { friendlyError } from '../../utils/errors';

interface RequestAccessModalProps {
  plan: string;
  onClose: () => void;
}

/**
 * There is no self-serve signup backend yet (see CLAUDE.md — single-tenant
 * app): submitting here just records the request (POST /api/orders) and
 * notifies contact@taches-and-cash.com — no account or company is
 * provisioned. A human confirms payment and activates access manually once
 * the multi-tenant model exists to isolate each customer's own workspace.
 */
export const RequestAccessModal: React.FC<RequestAccessModalProps> = ({ plan, onClose }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — real visitors never see this field
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, company, plan, message, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Une erreur est survenue.');
        return;
      }
      setReference(data.reference);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-navy">
            {reference ? 'Demande envoyée' : `Demande d'accès — ${plan}`}
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
              Nous vous recontactons sous 24–48h pour activer votre compte {plan}.
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
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-md">
                <p className="text-[12.5px] text-red-700 font-medium">{error}</p>
              </div>
            )}
            <div>
              <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Nom</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="Votre nom"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Email</label>
              <input
                required
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="vous@entreprise.com"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Entreprise</label>
              <input
                required
                value={company}
                onChange={e => setCompany(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="Nom de votre cabinet / entreprise"
              />
            </div>
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
              Envoyer ma demande
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
