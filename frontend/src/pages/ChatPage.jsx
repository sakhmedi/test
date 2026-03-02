import { useEffect, useRef, useState } from 'react';
import api from '../api';
import Header from '../components/Header';
import MessageBubble from '../components/MessageBubble';
import SourceCard from '../components/SourceCard';
import VoiceButton from '../components/VoiceButton';

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastSources, setLastSources] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);
    setLastSources([]);

    try {
      const res = await api.post('/chat', { question });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.answer }]);
      setLastSources(res.data.sources || []);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Something went wrong.';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${detail}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <Header />

      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 py-6 gap-4 overflow-hidden">
        {/* Message area */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {messages.length === 0 && (
            <div className="text-center mt-20">
              <p className="text-slate-400 text-lg font-medium">Ask anything about your documents</p>
              <p className="text-slate-600 text-sm mt-2">Upload documents first, then start a conversation</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} role={msg.role} content={msg.content} />
          ))}
          {loading && (
            <div className="flex justify-start mb-3">
              <div className="bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-slate-400">
                <span className="animate-pulse">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Sources */}
        {lastSources.length > 0 && (
          <div>
            <p className="text-slate-500 text-xs mb-2">Sources</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {lastSources.map((src, i) => (
                <SourceCard key={i} filename={src.filename} excerpt={src.excerpt} page={src.page} />
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={sendMessage} className="flex items-end gap-2">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(e);
              }
            }}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:border-indigo-500"
          />
          <VoiceButton onTranscribed={(text) => setInput((prev) => prev + text)} />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
