import { useRef, useState } from 'react';
import api from '../api';

export default function VoiceButton({ onTranscribed, onError }) {
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
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
          onError?.(err.response?.data?.detail || 'Transcription failed.');
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        onError?.('Microphone permission denied.');
      } else {
        onError?.('Could not access microphone: ' + err.message);
      }
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <button
      type="button"
      onClick={recording ? stopRecording : startRecording}
      title={recording ? 'Stop recording' : 'Start voice input'}
      className={`p-1 rounded-full transition-colors ${
        recording
          ? 'text-red-500 animate-pulse'
          : 'text-gray-400 hover:text-gray-600'
      }`}
    >
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-7 10a7 7 0 0 0 14 0h2a9 9 0 0 1-8 8.94V22h-2v-2.06A9 9 0 0 1 3 11h2z" />
      </svg>
    </button>
  );
}
