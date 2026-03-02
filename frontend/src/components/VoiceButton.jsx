import { useRef, useState } from 'react';
import api from '../api';

export default function VoiceButton({ onTranscribed }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const form = new FormData();
        form.append('file', blob, 'recording.webm');
        try {
          const res = await api.post('/speech/transcribe', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          onTranscribed(res.data.text || '');
        } catch (err) {
          setError(err.response?.data?.detail || 'Transcription failed.');
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
    } catch (err) {
      // FIXED: was using a single generic message; now maps error names to specific messages
      if (err.name === 'NotAllowedError') {
        setError('Microphone permission denied.');
      } else {
        setError('Could not access microphone: ' + err.message);
      }
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        title={recording ? 'Stop recording' : 'Start voice input'}
        className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
          recording
            ? 'bg-red-500 hover:bg-red-600 animate-pulse'
            : 'bg-slate-700 hover:bg-slate-600'
        }`}
      >
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-7 10a7 7 0 0 0 14 0h2a9 9 0 0 1-8 8.94V22h-2v-2.06A9 9 0 0 1 3 11h2z" />
        </svg>
      </button>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}
