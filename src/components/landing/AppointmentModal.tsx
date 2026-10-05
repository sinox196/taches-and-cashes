import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, CalendarCheck, CheckCircle2 } from 'lucide-react';
import { friendlyError } from '../../utils/errors';

interface AppointmentModalProps {
  onClose: () => void;
}

/**
 * "Prendre rendez-vous" — a visitor picks a date and a time, leaves their
 * contact details, and POSTs to /api/appointments, which persists the
 * request and notifies contact@taches-and-cash.com. Same dialog chrome,
 * honeypot and success-state pattern as RequestAccessModal — a second,
 * simpler flow rather than a third branch bolted onto that one, since this
 * form has no plan/seat logic to share with it.
 */
export const AppointmentModal: React.FC<AppointmentModalProps> = ({ onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  const todayIso = new Date().toISOString().slice(0, 10);

  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [date, setDate] = useState('');
  const [heure, setHeure] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — real visitors never see this field
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom, prenom, email, telephone, date, heure, website }),
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
    <dialog ref={dialogRef} aria-labelledby="appointment-title" className="request-access-dialog" onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 id="appointment-title" className="text-[16px] font-bold text-navy">
            {reference ? 'Rendez-vous demandé' : 'Prendre rendez-vous'}
          </h2>
          <button aria-label="Fermer le formulaire" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {reference ? (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-turquoise/10 text-turquoise flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <p className="text-[14.5px] font-semibold text-gray-900 mb-1.5">Merci, votre demande est bien reçue !</p>
            <p className="text-[13.5px] text-gray-600 leading-relaxed">
              Nous vous recontactons pour confirmer votre créneau du {date} à {heure}.
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
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-md">
                <p className="text-[12.5px] text-red-700 font-medium">{error}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Date</label>
                <input
                  required
                  type="date"
                  min={todayIso}
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Heure</label>
                <input
                  required
                  type="time"
                  step={1800}
                  min="08:00"
                  max="18:00"
                  value={heure}
                  onChange={e => setHeure(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Prénom</label>
                <input
                  required
                  value={prenom}
                  onChange={e => setPrenom(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  placeholder="Votre prénom"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Nom</label>
                <input
                  required
                  value={nom}
                  onChange={e => setNom(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  placeholder="Votre nom"
                />
              </div>
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
              <label className="block text-[12.5px] font-semibold text-gray-700 mb-1">Téléphone</label>
              <input
                required
                type="tel"
                value={telephone}
                onChange={e => setTelephone(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="+216 XX XXX XXX"
              />
            </div>

            {/* Honeypot: hidden from real visitors via CSS, off-screen — a bot that fills every field fills this one too. */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label htmlFor="appointment-website">Website</label>
              <input id="appointment-website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13.5px] font-bold text-white bg-navy hover:bg-navy-hover disabled:opacity-70 transition-colors"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
              Réserver
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
};
