import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Download, Film, Upload } from 'lucide-react';
import { createComicVideo, readComicAudio, type ComicVideo as VideoResult, type VideoProgress } from '@/lib/comic-video';
import { saveFile, type DownloadableComic } from '@/lib/download-comic';

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export function ComicVideo({ comic, disabled, onBusyChange }: {
  comic: DownloadableComic; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const inputId = useId();
  const audio = useRef<AudioBuffer | null>(null);
  const operation = useRef<AbortController | null>(null);
  const selection = useRef(0);
  const [audioName, setAudioName] = useState('');
  const [duration, setDuration] = useState(0);
  const [reading, setReading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [result, setResult] = useState<(VideoResult & { url: string }) | null>(null);
  const busy = reading || exporting;
  const downloadName = `${comic.title.replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 80) || 'Noir comic'} - with audio.mp4`;

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => () => { selection.current++; operation.current?.abort(); }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => {
    operation.current?.abort();
    setResult(null);
    setProgress(null);
    setError('');
  }, [comic]);

  async function selectAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const version = ++selection.current;
    audio.current = null;
    setAudioName('');
    setDuration(0);
    setResult(null);
    setProgress(null);
    setError('');
    setReading(true);
    try {
      const decoded = await readComicAudio(file);
      if (version !== selection.current) return;
      audio.current = decoded;
      setAudioName(file.name);
      setDuration(decoded.duration);
    } catch (cause) {
      if (version === selection.current) setError(cause instanceof Error ? cause.message : 'This audio file could not be read.');
    } finally {
      if (version === selection.current) setReading(false);
    }
  }

  async function exportVideo() {
    if (!audio.current || busy || disabled) return;
    const controller = new AbortController();
    operation.current = controller;
    setExporting(true);
    setError('');
    setResult(null);
    try {
      const video = await createComicVideo(comic, audio.current, controller.signal, setProgress);
      if (controller.signal.aborted) return;
      setResult({ ...video, url: URL.createObjectURL(video.blob) });
      saveFile(video.blob, downloadName);
    } catch (cause) {
      setProgress(null);
      if (controller.signal.aborted) setError('Video creation stopped. Your comic and selected audio are unchanged.');
      else setError(cause instanceof Error ? cause.message : 'Video creation failed. Your comic is unchanged.');
    } finally {
      operation.current = null;
      setExporting(false);
    }
  }

  return (
    <div className="comic-downloads" data-testid="comic-video">
      <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Create video with audio</h3>
      <p className="usage-note">Choose your music or other audio. Each panel appears in order for the same amount of time, and the video lasts as long as your audio. All dialogue is included.</p>
      <div className="comic-download-buttons">
        <label className="voice-button" htmlFor={inputId} style={{ cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled || busy ? 0.55 : 1 }}>
          <Upload size={15} /> {reading ? 'Reading audio…' : audioName ? 'Replace audio' : 'Choose audio file'}
        </label>
        <input id={inputId} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.aiff,.aif,.webm" hidden disabled={disabled || busy} onChange={event => { void selectAudio(event); }} data-testid="input-video-audio" />
        <button className="voice-button" type="button" disabled={disabled || busy || !duration} onClick={() => { void exportVideo(); }} data-testid="button-create-video">
          <Film size={15} /> {exporting ? 'Creating MP4…' : 'Create and download MP4'}
        </button>
        {exporting && <button className="voice-button" type="button" onClick={() => operation.current?.abort()} data-testid="button-cancel-video">Stop video creation</button>}
      </div>
      {audioName && <p className="usage-note" data-testid="video-timing">{audioName} · {timeLabel(duration)} · {comic.panels.length} {comic.panels.length === 1 ? 'panel' : 'panels'} · {(duration / comic.panels.length).toFixed(2)} seconds per panel</p>}
      <p className="usage-note">Audio stays on your PC; no AI generation or microphone access is used. MP3, WAV and M4A are recommended. Maximum 100 MB / 30 minutes. Keep this page open until the download is ready.</p>
      {progress && <div role="status" aria-live="polite" data-testid="status-video-progress">
        <p className="usage-note">{progress.message} {progress.percent}%</p>
        <progress value={progress.percent} max={100} aria-label="Video creation progress" style={{ width: '100%' }} />
      </div>}
      {error && <div className="error-box" role="alert" data-testid="status-video-error">{error}</div>}
      {result && <div data-testid="video-result">
        <video controls preload="metadata" src={result.url} style={{ display: 'block', width: '100%', maxWidth: 360, maxHeight: 540, margin: '12px auto', background: '#111' }} aria-label="Comic video with your audio" />
        <button className="voice-button" type="button" onClick={() => saveFile(result.blob, downloadName)}><Download size={15} /> Download MP4 again</button>
        {result.codec === 'vp9' && <p className="usage-note">This browser used VP9 video inside the MP4. Chrome, Edge and VLC can play it.</p>}
      </div>}
    </div>
  );
}
