import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Lock, User, Loader2, Globe, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react';
import { Logo } from '../components/Logo';
import { friendlyError } from '../utils/errors';

interface LoginProps {
  onBack?: () => void;
}

export const Login: React.FC<LoginProps> = ({ onBack }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, authMessage } = useAuth();
  const { t, language, setLanguage } = useLanguage();

  // 'login' is the normal form; 'forgot' asks for the account's email;
  // 'forgotSent' is the generic confirmation — always shown regardless of
  // whether the email matched anything, so this can't be used to probe
  // which addresses have an account.
  const [mode, setMode] = useState<'login' | 'forgot' | 'forgotSent'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        login(data.token, data.user);
      } else {
        setError(data.error || t('login.error'));
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setMode('forgotSent');
    } catch (err) {
      setForgotError(friendlyError(err));
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans antialiased relative">
      {onBack && (
        <button
          onClick={onBack}
          className="absolute top-4 left-4 flex items-center gap-1.5 text-[13px] font-medium text-gray-500 hover:text-navy transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
        </button>
      )}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <Globe className="w-5 h-5 text-gray-500" />
        <select 
          value={language}
          onChange={(e) => setLanguage(e.target.value as 'fr' | 'en')}
          className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer"
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </div>

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
          {t('login.title')}
        </h2>
        <p className="mt-2 text-center text-[14px] text-gray-600">
          {t('login.subtitle')}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl shadow-gray-200/50 sm:rounded-xl sm:px-10 border border-gray-100">
          {mode === 'forgotSent' ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-turquoise/10 text-turquoise flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-[14.5px] font-semibold text-gray-900 mb-1.5">Email envoyé</p>
              <p className="text-[13.5px] text-gray-600 leading-relaxed mb-6">
                Si un compte existe avec cette adresse, un lien de réinitialisation vient de lui être envoyé.
              </p>
              <button
                onClick={() => { setMode('login'); setForgotEmail(''); }}
                className="w-full py-2.5 rounded-lg text-[13.5px] font-bold text-white bg-navy hover:bg-navy-hover transition-colors"
              >
                Retour à la connexion
              </button>
            </div>
          ) : mode === 'forgot' ? (
            <form className="space-y-6" onSubmit={handleForgotSubmit}>
              <p className="text-[13px] text-gray-600 leading-relaxed">
                Indiquez l'adresse email utilisée à la création de votre compte — nous vous enverrons un lien pour
                choisir un nouveau mot de passe.
              </p>

              {forgotError && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md">
                  <p className="text-sm text-red-700 font-medium">{forgotError}</p>
                </div>
              )}

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-[14px] transition-colors"
                    placeholder="vous@entreprise.com"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setForgotError(''); }}
                  className="flex-1 py-2.5 px-4 border border-gray-300 rounded-lg text-[14px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="flex-1 flex justify-center py-2.5 px-4 rounded-lg shadow-sm text-[14px] font-bold text-white bg-navy hover:bg-navy-hover transition-colors disabled:opacity-70"
                >
                  {forgotLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Envoyer le lien'}
                </button>
              </div>
            </form>
          ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            {!error && authMessage && (
              <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-md">
                <p className="text-sm text-amber-800 font-medium">{authMessage}</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md">
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}
            
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                {t('login.username')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-[14px] transition-colors"
                  placeholder="ex: admin"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                {t('login.password')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-[14px] transition-colors"
                  placeholder="••••••••"
                />
              </div>
              <div className="flex justify-end mt-1.5">
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setError(''); }}
                  className="text-[12.5px] font-medium text-navy hover:underline"
                >
                  Mot de passe oublié ?
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mt-2">
              <div className="text-[12px] text-gray-500">
                <p>Demo accounts:</p>
                <p><strong className="text-gray-700">admin</strong> / admin123</p>
                <p><strong className="text-gray-700">collab</strong> / collab123</p>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-[14px] font-bold text-white bg-navy hover:bg-navy-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('login.button')}
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  );
};
