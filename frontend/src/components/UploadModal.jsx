import { useRef, useState } from 'react';
import api from '../api';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.txt',
  '.png', '.jpg', '.jpeg', '.tiff',
  '.xlsx', '.xls',
  '.pptx',
]);

function getFileIcon(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.tiff'].includes(ext)) return '🖼️';
  if (['.xlsx', '.xls'].includes(ext)) return '📊';
  if (['.pptx'].includes(ext)) return '📑';
  return '📄';
}

function getExt(filename) {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.slice(idx).toLowerCase() : '';
}

export default function UploadModal({ onClose, onUploaded }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const inputRef = useRef(null);

  async function uploadFile(file) {
    const ext = getExt(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      setError(`Unsupported format "${ext}". Allowed: PDF, Word, TXT, PNG, JPG, TIFF, XLSX, XLS, PPTX.`);
      return;
    }
    setSelectedFile(file);
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) uploadFile(file);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-md shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-white">Upload Document</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">
            ×
          </button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
            dragging ? 'border-indigo-400 bg-indigo-900/20' : 'border-slate-600 hover:border-slate-400'
          }`}
        >
          {selectedFile && uploading ? (
            <p className="text-slate-200 text-sm">
              {getFileIcon(selectedFile.name)} {selectedFile.name}
            </p>
          ) : (
            <>
              <p className="text-slate-300 mb-1">Drag &amp; drop a file here</p>
              <p className="text-slate-500 text-sm">or click to browse</p>
              <p className="text-slate-600 text-xs mt-2">
                📄 PDF, Word, TXT &nbsp;|&nbsp; 🖼️ PNG, JPG, TIFF &nbsp;|&nbsp; 📊 XLSX, XLS &nbsp;|&nbsp; 📑 PPTX
              </p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.xlsx,.xls,.pptx"
            onChange={handleFileChange}
          />
        </div>

        {uploading && (
          <div className="mt-4 flex items-center gap-2 text-sky-400 text-sm">
            <span className="animate-spin">⟳</span> Uploading…
          </div>
        )}
        {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}
