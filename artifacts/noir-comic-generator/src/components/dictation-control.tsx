import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { transcribeComicAudio } from '@workspace/api-client-react';
import { errorMessage } from '@/lib/error-message';

type Phase = 'idle' | 'requesting' | 'recording' | 'stopping' | 'transcribing' | 'error';
type Props = { disabled: boolean; onBusyChange: (busy: boolean) => void; onTranscript: (text: string) => void };
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_DURATION = 5 * 60 * 1000;

export function DictationControl({ disabled, onBusyChange, onTranscript }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pendingAudio = useRef<Blob | null>(null);
  const pendingTranscript = useRef<string | null>(null);
  const upload = useRef<AbortController | null>(null);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout> }>({});
  const callbacks = useRef({ onBusyChange, onTranscript });
  callbacks.current = { onBusyChange, onTranscript };

  function releaseMicrophone() {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.stop);
    timers.current = {};
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      upload.current?.abort();
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      releaseMicrophone();
    };
  }, []);

  async function insertRecording(audio: Blob) {
    setPhase('transcribing');
    setMessage('AssemblyAI is transcribing your recording…');
    callbacks.current.onBusyChange(true);
    const controller = new AbortController();
    upload.current = controller;
    try {
      const text = pendingTranscript.current ?? (await transcribeComicAudio(audio, {
        headers: { 'Content-Type': audio.type },
        signal: controller.signal,
      })).text;
      if (!mounted.current) return;
      pendingTranscript.current = text;
      callbacks.current.onTranscript(text);
      pendingAudio.current = null;
      pendingTranscript.current = null;
      setPhase('idle');
      setMessage('Dictation added to your input by AssemblyAI. You can edit it in the input or continue dictating.');
    } catch (error) {
      if (!mounted.current) return;
      setPhase('error');
      setMessage(errorMessage(error, 'Transcription failed. Your recording is kept on this page so you can retry.'));
    } finally {
      if (upload.current === controller) upload.current = null;
      if (mounted.current) callbacks.current.onBusyChange(false);
    }
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') {
      setPhase('stopping');
      setMessage('Finishing your recording…');
      recorder.current.stop();
      releaseMicrophone();
    }
  }

  async function startRecording() {
    if (disabled || ['requesting', 'recording', 'stopping', 'transcribing'].includes(phase)) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setPhase('error');
      setMessage('Microphone recording is unavailable in this browser. Use an updated browser or the microphone on your phone’s keyboard.');
      return;
    }
    setPhase('requesting');
    setMessage('Allow microphone access to dictate your script or story idea.');
    callbacks.current.onBusyChange(true);
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { audioStream.getTracks().forEach(track => track.stop()); return; }
      stream.current = audioStream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(type => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
      recorder.current = instance;
      const chunks: Blob[] = [];
      let interrupted = false;
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onerror = () => { interrupted = true; releaseMicrophone(); };
      instance.onstop = () => {
        releaseMicrophone();
        if (!mounted.current) return;
        const audio = new Blob(chunks, { type: instance.mimeType || mimeType || 'audio/webm' });
        if (!audio.size || audio.size > MAX_BYTES) {
          setPhase('error');
          setMessage(audio.size ? 'The recording is too large. Please dictate a shorter section.' : 'The recording was empty. Try again and speak clearly.');
          callbacks.current.onBusyChange(false);
          return;
        }
        pendingAudio.current = audio;
        if (interrupted) {
          setPhase('error');
          setMessage('Recording was interrupted. You can retry transcription of the audio captured so far.');
          callbacks.current.onBusyChange(false);
        } else {
          void insertRecording(audio);
        }
      };
      instance.start(1000);
      pendingAudio.current = null;
      pendingTranscript.current = null;
      const started = Date.now();
      setElapsed(0);
      setPhase('recording');
      setMessage('Listening. Stop dictation to put your words into the input. Maximum five minutes per recording.');
      timers.current.tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
      timers.current.stop = setTimeout(stopRecording, MAX_DURATION);
    } catch (error) {
      releaseMicrophone();
      if (!mounted.current) return;
      const name = error instanceof DOMException ? error.name : '';
      setPhase('error');
      setMessage(name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in your browser settings, then try again. Your phone’s keyboard microphone is another option.'
        : name === 'NotFoundError'
          ? 'No microphone was found. Connect one or use your phone’s keyboard microphone.'
          : 'The microphone could not start. Close any other app using it, then try again.');
      callbacks.current.onBusyChange(false);
    }
  }

  const waiting = ['requesting', 'stopping', 'transcribing'].includes(phase);
  return (
    <div className="dictation-control">
      <div className="dictation-actions">
        <button type="button" className={`voice-button${phase === 'recording' ? ' recording' : ''}`} data-testid="button-dictate" disabled={disabled || waiting} onClick={phase === 'recording' ? stopRecording : startRecording} aria-pressed={phase === 'recording'}>
          {phase === 'recording' ? <Square size={14} /> : <Mic size={15} />}
          {phase === 'recording' ? `Stop dictation · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : waiting ? (phase === 'transcribing' ? 'Transcribing…' : 'Please wait…') : 'Dictate'}
        </button>
        {phase === 'error' && pendingAudio.current && <button type="button" className="file-button" data-testid="button-retry-transcription" disabled={disabled} onClick={() => { if (pendingAudio.current) void insertRecording(pendingAudio.current); }}>Retry transcription</button>}
      </div>
      <p className={`usage-note${phase === 'error' ? ' dictation-error' : ''}`} data-testid="status-dictation" role={phase === 'error' ? 'alert' : 'status'}>{message || 'Speak your script or idea. AssemblyAI adds the words when you stop.'}</p>
      {phase === 'error' && typeof window !== 'undefined' && window.self !== window.top && <p className="usage-note">If microphone access is blocked in this embedded preview, <a href={window.location.href} target="_blank" rel="noopener noreferrer">open the app in its own tab</a> and dictate there.</p>}
      <p className="dictation-privacy">Recordings are sent to AssemblyAI for transcription. This app does not save your audio.</p>
    </div>
  );
}
