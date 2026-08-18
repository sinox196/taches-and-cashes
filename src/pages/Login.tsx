import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Lock, User, Loader2, Globe } from 'lucide-react';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, authMessage } = useAuth();
  const { t, language, setLanguage } = useLanguage();

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
      setError('An error occurred while connecting to the server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans antialiased relative">
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
          <div className="w-12 h-12 bg-[#101828] text-white rounded-xl flex items-center justify-center shadow-lg">
            <div className="w-6 h-6 border-2 border-white rounded-full flex items-center justify-center relative">
              <div className="w-1.5 h-3 border-r-2 border-b-2 border-white transform rotate-45 mb-0.5"></div>
            </div>
          </div>
        </div>
        <h2 className="mt-6 text-center text-[24px] font-extrabold text-gray-900 tracking-tight">
          {t('login.title')}
        </h2>
        <p className="mt-2 text-center text-[14px] text-gray-600">
          {t('login.subtitle')}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl shadow-gray-200/50 sm:rounded-xl sm:px-10 border border-gray-100">
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
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-[14px] font-bold text-white bg-[#101828] hover:bg-[#1d2939] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('login.button')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
