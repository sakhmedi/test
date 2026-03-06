import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import MessageBubble from '../components/MessageBubble';
import SourceCard from '../components/SourceCard';
import VoiceButton from '../components/VoiceButton';
import Toast from '../components/Toast';

function groupSessionsByDate(sessions, t) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = {
    [t('today')]: [],
    [t('yesterday')]: [],
    [t('last7days')]: [],
    [t('earlier')]: [],
  };
  const keys = [t('today'), t('yesterday'), t('last7days'), t('earlier')];
  for (const s of sessions) {
    const d = new Date(s.created_at);
    d.setHours(0, 0, 0, 0);
    if (d >= today) groups[keys[0]].push(s);
    else if (d >= yesterday) groups[keys[1]].push(s);
    else if (d >= weekAgo) groups[keys[2]].push(s);
    else groups[keys[3]].push(s);
  }
  return { groups, keys };
}

export default function ChatPage() {
  const { logout } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [viewingSessionId, setViewingSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [toast, setToast] = useState(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hoveredSession, setHoveredSession] = useState(null);

  // Trash: client-side soft delete stored in localStorage
  const [trashedSessions, setTrashedSessions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('trashed_sessions') || '[]');
    } catch {
      return [];
    }
  });
  const [trashOpen, setTrashOpen] = useState(false);

  // Documents in current session
  const [sessionDocs, setSessionDocs] = useState([]);
  const [docsOpen, setDocsOpen] = useState(false);

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  function saveTrashed(list) {
    setTrashedSessions(list);
    localStorage.setItem('trashed_sessions', JSON.stringify(list));
  }

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (currentSessionId) {
      fetchSessionDocs(currentSessionId);
    } else {
      setSessionDocs([]);
    }
  }, [currentSessionId]);

  async function fetchSessions() {
    try {
      const res = await api.get('/chat/sessions');
      setSessions(res.data || []);
    } catch {
      // silently ignore
    }
  }

  async function fetchSessionDocs(sessionId) {
    try {
      const res = await api.get('/documents/');
      const docs = (res.data || []).filter((d) => d.session_id === sessionId);
      setSessionDocs(docs);
    } catch {
      // silently ignore
    }
  }

  async function loadSession(sessionId) {
    try {
      const res = await api.get(`/chat/sessions/${sessionId}`);
      const msgs = (res.data || []).map((m) => ({ ...m, sources: [] }));
      setMessages(msgs);
      setViewingSessionId(sessionId);
      setCurrentSessionId(sessionId);
    } catch {
      showToast(t('failedLoad'));
    }
  }

  function startNewChat() {
    setMessages([]);
    setCurrentSessionId(null);
    setViewingSessionId(null);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.style.overflowY = 'hidden';
    }
  }

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.style.overflowY = 'hidden';
    }
    setViewingSessionId(null);
    setMessages((prev) => [...prev, { role: 'user', content: question, sources: [] }]);
    setLoading(true);

    try {
      const res = await api.post('/chat', {
        question,
        session_id: currentSessionId,
      });
      const newSessionId = res.data.session_id;
      setCurrentSessionId(newSessionId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.data.answer, sources: res.data.sources || [] },
      ]);
      fetchSessions();
    } catch (err) {
      const detail = err.response?.data?.detail || t('failedLoad');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${detail}`, sources: [] },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoResize() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, 200);
    ta.style.height = next + 'px';
    ta.style.overflowY = ta.scrollHeight > 200 ? 'auto' : 'hidden';
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    setUploadProgress(0);
    setMessages((prev) => [
      ...prev,
      { role: 'system', content: `⏳ ${t('uploadingDoc')} «${file.name}»…`, sources: [] },
    ]);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('session_id', currentSessionId || 'new');
      const uploadRes = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (ev) => {
          if (ev.total) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      if (uploadRes.data?.session_id && !currentSessionId) {
        setCurrentSessionId(uploadRes.data.session_id);
      }
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === 'system' && updated[i].content.includes(file.name)) {
            updated[i] = {
              role: 'system',
              content: `✅ «${file.name}» ${t('uploadedDoc')}`,
              sources: [],
            };
            break;
          }
        }
        return updated;
      });
      // Refresh docs for this session
      if (uploadRes.data?.session_id) {
        fetchSessionDocs(uploadRes.data.session_id);
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === 'system' && updated[i].content.includes(file.name)) {
            updated[i] = {
              role: 'system',
              content: `❌ ${t('uploadError')} «${file.name}»: ${err.response?.data?.detail || ''}`,
              sources: [],
            };
            break;
          }
        }
        return updated;
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  // Soft-delete: move to trash (no API call)
  function deleteSession(e, session) {
    e.stopPropagation();
    const updated = [...trashedSessions, session];
    saveTrashed(updated);
    setSessions((prev) => prev.filter((s) => s.id !== session.id));
    if (currentSessionId === session.id) {
      startNewChat();
    }
  }

  // Restore from trash
  function restoreSession(sessionId) {
    const session = trashedSessions.find((s) => s.id === sessionId);
    if (!session) return;
    saveTrashed(trashedSessions.filter((s) => s.id !== sessionId));
    setSessions((prev) => [session, ...prev]);
  }

  // Permanently delete one trashed session
  async function permanentlyDelete(sessionId) {
    try {
      await api.delete(`/chat/sessions/${sessionId}`);
    } catch {
      // ignore if already gone
    }
    saveTrashed(trashedSessions.filter((s) => s.id !== sessionId));
    if (currentSessionId === sessionId) startNewChat();
  }

  // Empty entire trash
  async function emptyTrash() {
    await Promise.all(
      trashedSessions.map((s) =>
        api.delete(`/chat/sessions/${s.id}`).catch(() => {})
      )
    );
    saveTrashed([]);
  }

  // Delete a document from current session
  async function deleteDoc(docId) {
    try {
      await api.delete(`/documents/${docId}`);
      setSessionDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      showToast(t('failedDelete'));
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const visibleSessions = sessions.filter(
    (s) => !trashedSessions.some((t) => t.id === s.id)
  );
  const { groups, keys } = groupSessionsByDate(visibleSessions, t);
  const activeTitle = sessions.find((s) => s.id === currentSessionId)?.title;

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900 overflow-hidden">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        } flex-shrink-0 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-200`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="w-8 h-8 bg-[#1a56db] rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold">D</span>
          </div>
          <span className="text-gray-900 dark:text-white font-semibold text-base">DocuFlow AI</span>
        </div>

        {/* New Chat button */}
        <div className="px-3 py-3">
          <button
            onClick={startNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('newChat')}
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {keys.map((label) => {
            const group = groups[label];
            if (!group || group.length === 0) return null;
            return (
              <div key={label} className="mb-2">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider px-2 py-1">
                  {label}
                </p>
                <ul className="space-y-0.5">
                  {group.map((s) => (
                    <li
                      key={s.id}
                      className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        currentSessionId === s.id
                          ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                      onClick={() => loadSession(s.id)}
                      onMouseEnter={() => setHoveredSession(s.id)}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <span className="flex-1 text-xs truncate">{s.title}</span>
                      {(hoveredSession === s.id || currentSessionId === s.id) && (
                        <button
                          onClick={(e) => deleteSession(e, s)}
                          className="flex-shrink-0 p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                          title={t('delete')}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {visibleSessions.length === 0 && (
            <p className="text-gray-400 text-xs px-2 mt-2">{t('noChats')}</p>
          )}

          {/* Trash section */}
          <div className="mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
            <button
              onClick={() => setTrashOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="flex-1 text-left font-medium uppercase tracking-wider">{t('trash')}</span>
              {trashedSessions.length > 0 && (
                <span className="bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                  {trashedSessions.length}
                </span>
              )}
              <svg
                className={`w-3 h-3 transition-transform ${trashOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {trashOpen && (
              <div className="mt-1 space-y-0.5">
                {trashedSessions.length === 0 ? (
                  <p className="text-gray-400 text-xs px-2 py-1">{t('noTrash')}</p>
                ) : (
                  <>
                    {trashedSessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-500 dark:text-gray-400"
                      >
                        <span className="flex-1 text-xs truncate">{s.title}</span>
                        <button
                          onClick={() => restoreSession(s.id)}
                          className="flex-shrink-0 p-0.5 text-gray-400 hover:text-green-500 transition-colors"
                          title={t('restore')}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                        </button>
                        <button
                          onClick={() => permanentlyDelete(s.id)}
                          className="flex-shrink-0 p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                          title={t('delete')}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={emptyTrash}
                      className="w-full text-left px-2 py-1 text-xs text-red-500 hover:text-red-600 transition-colors"
                    >
                      {t('emptyTrash')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Documents in current session */}
        {currentSessionId && (
          <div className="px-2 pb-2 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setDocsOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-2 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="flex-1 text-left font-medium uppercase tracking-wider">{t('documentsInChat')}</span>
              <svg
                className={`w-3 h-3 transition-transform ${docsOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {docsOpen && (
              <div className="space-y-0.5">
                {sessionDocs.length === 0 ? (
                  <p className="text-gray-400 text-xs px-2 py-1">{t('noDocs')}</p>
                ) : (
                  sessionDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-600 dark:text-gray-400"
                    >
                      <span className="flex-1 text-xs truncate" title={doc.filename}>
                        📄 {doc.filename}
                      </span>
                      <button
                        onClick={() => deleteDoc(doc.id)}
                        className="flex-shrink-0 p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                        title={t('delete')}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer: theme toggle, language switcher, logout */}
        <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
          {/* Theme + Language row */}
          <div className="flex items-center gap-1 px-1">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={theme === 'dark' ? t('light') : t('dark')}
            >
              {theme === 'dark' ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10A5 5 0 0012 7z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* Language switcher */}
            <div className="flex items-center gap-0.5 ml-auto">
              {['ru', 'kk', 'en'].map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                    lang === l
                      ? 'bg-[#1a56db] text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {t('logout')}
          </button>
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-gray-700 dark:text-gray-300 text-sm font-medium truncate">
            {activeTitle || t('newChat')}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 bg-white dark:bg-gray-900">
          <div className="max-w-2xl mx-auto space-y-1">
            {messages.length === 0 && !loading && (
              <div className="text-center mt-24">
                <div className="text-4xl mb-4">💬</div>
                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
                  {t('askQuestion')}
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  {t('uploadHint')}
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              if (msg.role === 'system') {
                return (
                  <div key={i} className="flex justify-center my-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1">
                      {msg.content}
                    </span>
                  </div>
                );
              }
              return (
                <div key={i}>
                  <MessageBubble role={msg.role} content={msg.content} />
                  {msg.role === 'assistant' && msg.sources?.length > 0 && (
                    <div className="ml-9 mb-3">
                      <p className="text-xs text-gray-400 mb-1.5">{t('sources')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {msg.sources.map((src, j) => (
                          <SourceCard
                            key={j}
                            filename={src.filename}
                            excerpt={src.excerpt}
                            page={src.page}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex justify-start mb-3">
                <div className="w-7 h-7 bg-[#1a56db] rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                  <span className="text-white text-xs font-bold">D</span>
                </div>
                <div className="flex items-center gap-1 pt-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input bar */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 bg-white dark:bg-gray-900">
          <div className="max-w-2xl mx-auto">
            {uploading && (
              <div className="mb-2">
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>{t('uploading')}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                  <div
                    className="bg-[#1a56db] h-1 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
            <div
              className={`flex items-end gap-2 border rounded-xl px-3 py-2 transition-colors ${
                inputFocused
                  ? 'border-[#1a56db] ring-1 ring-[#1a56db]'
                  : 'border-gray-300 dark:border-gray-600'
              } bg-white dark:bg-gray-800`}
            >
              {/* Paperclip upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-40 transition-colors flex-shrink-0"
                title={t('uploading')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.xlsx,.xls,.pptx"
                onChange={handleFileChange}
              />

              <VoiceButton
                onTranscribed={(text) => setInput((prev) => prev + text)}
                onError={showToast}
              />
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={t('placeholder')}
                className="flex-1 resize-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none bg-transparent py-1 max-h-[200px]"
                style={{ height: '24px', overflowY: 'hidden' }}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="p-1.5 rounded-lg bg-[#1a56db] text-white disabled:opacity-40 hover:bg-[#1648c0] transition-colors flex-shrink-0"
                title={t('send')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
