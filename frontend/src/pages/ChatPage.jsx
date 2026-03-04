import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import MessageBubble from '../components/MessageBubble';
import SourceCard from '../components/SourceCard';
import VoiceButton from '../components/VoiceButton';
import Toast from '../components/Toast';

function fileEmoji(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
  return '📎';
}

export default function ChatPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [toast, setToast] = useState(null);
  const [inputFocused, setInputFocused] = useState(false);

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Load docs and history on mount
  useEffect(() => {
    fetchDocs();
    fetchHistory();
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function fetchDocs() {
    try {
      const res = await api.get('/documents/');
      setDocs(res.data || []);
    } catch {
      // silently ignore
    }
  }

  async function fetchHistory() {
    try {
      const res = await api.get('/chat/history');
      const history = (res.data || []).map((m) => ({ ...m, sources: m.sources || [] }));
      setMessages(history);
    } catch {
      // silently ignore
    }
  }

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;

    setInput('');
    autoResize({ target: { value: '' } });
    setMessages((prev) => [...prev, { role: 'user', content: question, sources: [] }]);
    setLoading(true);

    try {
      const res = await api.post('/chat', { question });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.data.answer, sources: res.data.sources || [] },
      ]);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Something went wrong.';
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
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (ev) => {
          if (ev.total) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      await fetchDocs();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Toast */}
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

        {/* New Chat */}
        <div className="px-3 py-3">
          <button
            onClick={() => setMessages([])}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Docs list */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider px-1 mb-2">
            Documents
          </p>
          {docs.length === 0 ? (
            <p className="text-gray-400 text-xs px-1">No documents yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {docs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-default"
                  title={doc.filename}
                >
                  <span className="text-base leading-none">{fileEmoji(doc.filename)}</span>
                  <span className="text-xs text-gray-700 truncate">{doc.filename}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upload + progress */}
        <div className="px-3 py-3 border-t border-gray-200 space-y-2">
          {uploading && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Uploading…</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-[#1a56db] h-1.5 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload document
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.png,.jpg,.jpeg"
            onChange={handleFileChange}
          />

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
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
            title="Toggle sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-gray-700 text-sm font-medium">Chat</span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-2xl mx-auto space-y-1">
            {messages.length === 0 && !loading && (
              <div className="text-center mt-24">
                <div className="text-4xl mb-4">💬</div>
                <h2 className="text-xl font-semibold text-gray-800 mb-2">
                  Ask anything about your documents
                </h2>
                <p className="text-gray-500 text-sm">
                  Upload documents in the sidebar, then start a conversation.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                <MessageBubble role={msg.role} content={msg.content} />
                {msg.role === 'assistant' && msg.sources?.length > 0 && (
                  <div className="ml-9 mb-3">
                    <p className="text-xs text-gray-400 mb-1.5">Sources</p>
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
            ))}

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
            <div
              className={`flex items-end gap-2 border rounded-xl px-3 py-2 transition-colors ${
                inputFocused ? 'border-[#1a56db] ring-1 ring-[#1a56db]' : 'border-gray-300'
              }`}
            >
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
                placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
                className="flex-1 resize-none text-sm text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent py-1 max-h-[200px]"
                style={{ height: '24px' }}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="p-1.5 rounded-lg bg-[#1a56db] text-white disabled:opacity-40 hover:bg-[#1648c0] transition-colors flex-shrink-0"
                title="Send"
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
