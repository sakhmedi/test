import { useEffect, useState } from 'react';
import api from '../api';
import Header from '../components/Header';
import UploadModal from '../components/UploadModal';

const STATUS_STYLES = {
  pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
  processing: 'bg-blue-900/30 text-blue-400 border-blue-800',
  indexed: 'bg-green-900/30 text-green-400 border-green-800',
  error: 'bg-red-900/30 text-red-400 border-red-800',
};

export default function DocumentsPage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');  // FIXED: surface fetch/delete errors to user

  async function fetchDocs() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/documents/');
      setDocs(res.data);
    } catch (err) {
      // FIXED: was silently swallowing errors; now surfaces a message
      setError(err.response?.data?.detail || 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDocs(); }, []);

  async function handleDelete(id) {
    if (!window.confirm('Delete this document?')) return;
    setDeleting(id);
    try {
      await api.delete(`/documents/${id}`);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      // FIXED: was silently swallowing errors; now surfaces a message
      setError(err.response?.data?.detail || 'Failed to delete document.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <Header />

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">Documents</h2>
          <button
            onClick={() => setShowUpload(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Upload
          </button>
        </div>

        {error && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : docs.length === 0 ? (
          <div className="border border-dashed border-slate-700 rounded-xl p-12 text-center">
            <p className="text-slate-400 mb-2">No documents yet</p>
            <p className="text-slate-600 text-sm">Upload a PDF, Word doc, or image to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="bg-slate-900 border border-slate-700 rounded-xl px-5 py-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-slate-300 text-sm truncate">{doc.filename}</span>
                  <span
                    className={`text-xs border rounded-full px-2 py-0.5 flex-shrink-0 ${
                      STATUS_STYLES[doc.status] || STATUS_STYLES.pending
                    }`}
                  >
                    {doc.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <span className="text-slate-600 text-xs hidden sm:block">
                    {new Date(doc.created_at).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deleting === doc.id}
                    className="text-slate-500 hover:text-red-400 text-sm transition-colors disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={fetchDocs} />
      )}
    </div>
  );
}
