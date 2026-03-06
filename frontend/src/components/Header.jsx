import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Header() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="bg-slate-900 border-b border-slate-700 px-6 py-3 flex items-center justify-between">
      <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-sky-400 bg-clip-text text-transparent">
        Shart AI
      </span>
      <nav className="flex items-center gap-6 text-sm">
        <Link
          to="/documents"
          className="text-slate-300 hover:text-white transition-colors"
        >
          Documents
        </Link>
        <Link
          to="/chat"
          className="text-slate-300 hover:text-white transition-colors"
        >
          Chat
        </Link>
        <button
          onClick={handleLogout}
          className="text-slate-400 hover:text-red-400 transition-colors"
        >
          Logout
        </button>
      </nav>
    </header>
  );
}
