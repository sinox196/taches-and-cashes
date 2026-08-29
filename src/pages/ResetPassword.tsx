import React, { useState } from 'react';
import { Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { Logo } from '../components/Logo';
import { friendlyError } from '../utils/errors';

interface ResetPasswordProps {
  token: string;
  onDone: () => void;
}

/**
 * Reached only via the link mailed by POST /api/auth/forgot-password
 * (?reset=<token> on the app's own URL) — App.tsx renders this ahead of the
 * normal logged-in/logged-out split whenever that query param is present,
 * regardless of whether a session already exists in this browser.
 */
export const ResetPassword: React.FC<ResetPasswordProps> = ({ token, onDone }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Une erreur est survenue.');
        return;
      }
      setDone(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans antialiased">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-navy rounded-xl flex items-center justify-center shadow-lg">
            <Logo size={28} variant="white" />
          </div>
        </div>
        <p className="mt-4 text-center text-[15px] font-extrabold text-navy tracking-tight">
          Tâches <span className="text-turquoise">&amp;</span> Cash
        </p>
        <h2 className="mt-3 text-center text-[24px] font-extrabold text-gray-900 tracking-tight">
          Nouveau mot de passe
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl shadow-gray-200/50 sm:rounded-xl sm:px-10 border border-gray-100">
          {done ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-turquoise/10 text-turquoise flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-[14.5px] font-semibold text-gray-900 mb-1.5">Mot de passe mis à jour</p>
              <p className="text-[13.5px] text-gray-600 leading-relaxed mb-6">
                Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
              </p>
              <button
                onClick={onDone}
                className="w-full py-2.5 rounded-lg text-[13.5px] font-bold text-white bg-navy hover:bg-navy-hover transition-colors"
              >
                Aller à la connexion
              </button>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md">
                  <p className="text-sm text-red-700 font-medium">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Nouveau mot de passe</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-[14px] transition-colors"
                    placeholder="6 caractères minimum"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Confirmer le nouveau mot de passe</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-[14px] transition-colors"
                    placeholder="Retapez le mot de passe"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-[14px] font-bold text-white bg-navy hover:bg-navy-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Réinitialiser le mot de passe'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
