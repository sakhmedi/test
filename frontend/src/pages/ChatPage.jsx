import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import MessageBubble from '../components/MessageBubble';
import SourceCard from '../components/SourceCard';
import VoiceButton from '../components/VoiceButton';
import Toast from '../components/Toast';

function groupSessionsByDate(sessions) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = { 'Сегодня': [], 'Вчера': [], 'Последние 7 дней': [], 'Ранее': [] };
  for (const s of sessions) {
    const d = new Date(s.created_at);
    d.setHours(0, 0, 0, 0);
    if (d >= today) groups['Сегодня'].push(s);
    else if (d >= yesterday) groups['Вчера'].push(s);
    else if (d >= weekAgo) groups['Последние 7 дней'].push(s);
    else groups['Ранее'].push(s);
  }
  return groups;
}

export default function ChatPage() {
  const { logout } = useAuth();
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

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Load sessions on mount — do NOT load history
  useEffect(() => {
    fetchSessions();
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function fetchSessions() {
    try {
      const res = await api.get('/chat/sessions');
      setSessions(res.data || []);
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
      showToast('Не удалось загрузить чат.');
    }
  }

  function startNewChat() {
    setMessages([]);
    setCurrentSessionId(null);
    setViewingSessionId(null);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
    }
  }

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
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
      // Refresh sessions list to show new/updated session
      fetchSessions();
    } catch (err) {
      const detail = err.response?.data?.detail || 'Что-то пошло не так.';
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Ошибка: ${detail}`, sources: [] },
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

  function autoResize(e) {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    setUploadProgress(0);
    // Show uploading system message in chat
    setMessages((prev) => [
      ...prev,
      { role: 'system', content: `⏳ Загрузка документа «${file.name}»…`, sources: [] },
    ]);

    try {
      const form = new FormData();
      form.append('file', file);
      // Pass current session or request a new one; response gives us the session_id to use
      form.append('session_id', currentSessionId || 'new');
      const uploadRes = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (ev) => {
          if (ev.total) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      // Anchor this chat to the session the document was indexed into
      if (uploadRes.data?.session_id && !currentSessionId) {
        setCurrentSessionId(uploadRes.data.session_id);
      }
      // Replace uploading message with success
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === 'system' && updated[i].content.includes(file.name)) {
            updated[i] = {
              role: 'system',
              content: `✅ Документ «${file.name}» загружен и проиндексирован`,
              sources: [],
            };
            break;
          }
        }
        return updated;
      });
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === 'system' && updated[i].content.includes(file.name)) {
            updated[i] = {
              role: 'system',
              content: `❌ Ошибка загрузки «${file.name}»: ${err.response?.data?.detail || 'неизвестная ошибка'}`,
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

  async function deleteSession(e, sessionId) {
    e.stopPropagation();
    try {
      await api.delete(`/chat/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        startNewChat();
      }
    } catch {
      showToast('Не удалось удалить чат.');
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const grouped = groupSessionsByDate(sessions);
  const activeTitle = sessions.find((s) => s.id === currentSessionId)?.title;

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        } flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-200`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-200">
          <div className="w-8 h-8 bg-[#1a56db] rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold">D</span>
          </div>
          <span className="text-gray-900 font-semibold text-base">DocuFlow AI</span>
        </div>

        {/* New Chat button */}
        <div className="px-3 py-3">
          <button
            onClick={startNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Новый чат
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {Object.entries(grouped).map(([label, group]) => {
            if (group.length === 0) return null;
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
                          ? 'bg-gray-200 text-gray-900'
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                      onClick={() => loadSession(s.id)}
                      onMouseEnter={() => setHoveredSession(s.id)}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <span className="flex-1 text-xs truncate">{s.title}</span>
                      {(hoveredSession === s.id || currentSessionId === s.id) && (
                        <button
                          onClick={(e) => deleteSession(e, s.id)}
                          className="flex-shrink-0 p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                          title="Удалить"
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
          {sessions.length === 0 && (
            <p className="text-gray-400 text-xs px-2 mt-2">Нет предыдущих чатов</p>
          )}
        </div>

        {/* Logout */}
        <div className="px-3 py-3 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Выйти
          </button>
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            title="Переключить боковую панель"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-gray-700 text-sm font-medium truncate">
            {activeTitle || 'Новый чат'}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-2xl mx-auto space-y-1">
            {messages.length === 0 && !loading && (
              <div className="text-center mt-24">
                <div className="text-4xl mb-4">💬</div>
                <h2 className="text-xl font-semibold text-gray-800 mb-2">
                  Задайте вопрос о ваших документах
                </h2>
                <p className="text-gray-500 text-sm">
                  Загрузите документ с помощью 📎 и начните диалог
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              if (msg.role === 'system') {
                return (
                  <div key={i} className="flex justify-center my-2">
                    <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-3 py-1">
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
                      <p className="text-xs text-gray-400 mb-1.5">Источники</p>
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
        <div className="border-t border-gray-200 px-4 py-4">
          <div className="max-w-2xl mx-auto">
            {uploading && (
              <div className="mb-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Загрузка…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1">
                  <div
                    className="bg-[#1a56db] h-1 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
            <div
              className={`flex items-end gap-2 border rounded-xl px-3 py-2 transition-colors ${
                inputFocused ? 'border-[#1a56db] ring-1 ring-[#1a56db]' : 'border-gray-300'
              }`}
            >
              {/* Paperclip upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors flex-shrink-0"
                title="Загрузить документ"
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
                placeholder="Задайте вопрос… (Enter — отправить, Shift+Enter — новая строка)"
                className="flex-1 resize-none text-sm text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent py-1 max-h-[200px]"
                style={{ height: '24px' }}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="p-1.5 rounded-lg bg-[#1a56db] text-white disabled:opacity-40 hover:bg-[#1648c0] transition-colors flex-shrink-0"
                title="Отправить"
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
