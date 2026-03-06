import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/auth/login', { email, password });
      login(res.data.access_token);
      navigate('/chat');
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 bg-[#1a56db] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">D</span>
          </div>
          <span className="text-gray-900 dark:text-white font-semibold text-xl">Shart AI</span>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-1 text-center">{t('welcome')}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm text-center mb-8">{t('signIn')}</p>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4 shadow-sm"
        >
          {error && (
            <p className="text-red-600 text-sm bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label className="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-1">{t('email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#1a56db] focus:ring-1 focus:ring-[#1a56db]"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-1">{t('password')}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#1a56db] focus:ring-1 focus:ring-[#1a56db]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1a56db] hover:bg-[#1648c0] disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors"
          >
            {loading ? t('signingIn') : t('signInBtn')}
          </button>
        </form>

        <p className="text-gray-500 dark:text-gray-400 text-sm text-center mt-4">
          {t('noAccount')}{' '}
          <Link to="/register" className="text-[#1a56db] hover:underline">
            {t('register')}
          </Link>
        </p>
      </div>
    </div>
  );
}
