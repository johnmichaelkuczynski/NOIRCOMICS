import { createFramePng, type DownloadableComic } from './download-comic';

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 30 * 60;

export type VideoProgress = { percent: number; message: string };
export type ComicVideo = { blob: Blob; duration: number; secondsPerPanel: number; codec: string };

/** Use the decoded sample count, not rounded metadata, to time the slideshow. */
export function panelTiming(duration: number, count: number, index: number) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(count) || count < 1
    || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error('A valid audio duration and at least one comic panel are required.');
  }
  const start = duration * index / count;
  const end = duration * (index + 1) / count;
  return { start, duration: end - start };
}

export async function readComicAudio(file: File): Promise<AudioBuffer> {
  if (!file.size) throw new Error('This audio file is empty. Choose another file.');
  if (file.size > MAX_AUDIO_BYTES) throw new Error('Choose an audio file smaller than 100 MB.');
  // Decoding does not play the file, open a microphone or send audio to a server.
  const context = new OfflineAudioContext(2, 1, 48_000);
  let audio: AudioBuffer;
  try {
    audio = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as audio. Try an MP3, WAV or M4A file that plays in your browser.');
  }
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error('This file contains no playable audio.');
  if (audio.duration > MAX_AUDIO_SECONDS) throw new Error('Choose audio up to 30 minutes long for browser video export.');
  if (audio.numberOfChannels > 2) {
    const mixer = new OfflineAudioContext(2, audio.length, audio.sampleRate);
    const source = mixer.createBufferSource();
    source.buffer = audio;
    source.connect(mixer.destination);
    source.start();
    return mixer.startRendering();
  }
  return audio;
}

/**
 * Offline, local MP4 export: no AI calls, recording, microphone access or uploads.
 * A full-duration key frame per panel keeps timing exact without encoding thousands
 * of identical frames or depending on foreground timers / real-time playback.
 */
export async function createComicVideo(
  comic: DownloadableComic,
  audio: AudioBuffer,
  signal: AbortSignal,
  onProgress: (progress: VideoProgress) => void,
): Promise<ComicVideo> {
  signal.throwIfAborted();
  if (!comic.panels.length) throw new Error('Generate a comic before creating a video.');
  panelTiming(audio.duration, comic.panels.length, 0);
  onProgress({ percent: 0, message: 'Preparing video encoder…' });
  const {
    AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output,
    canEncodeAudio, getFirstEncodableVideoCodec,
  } = await import('mediabunny');
  signal.throwIfAborted();
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: 1024, height: 1536 });
  if (!codec) throw new Error('This browser cannot encode MP4 video. Open the PC app in a current version of Chrome or Edge.');
  if (!(await canEncodeAudio('aac', { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate }))) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1536;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the video frames.');
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoSource = new CanvasSource(canvas, { codec, bitrate: 5_000_000 });
  const audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
  output.addVideoTrack(videoSource);
  output.addAudioTrack(audioSource);
  output.setMetadataTags({ title: comic.title });
  let complete = false;
  let videoProgress = 0;
  let audioProgress = 0;
  const report = (message: string) => onProgress({
    percent: Math.min(98, Math.round((videoProgress + audioProgress) * 49)), message,
  });
  const abort = () => { void output.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await output.start();
    const renderPanels = async () => {
      for (let i = 0; i < comic.panels.length; i++) {
        signal.throwIfAborted();
        const frame = await createImageBitmap(await createFramePng(comic.panels[i]));
        try {
          signal.throwIfAborted();
          context.drawImage(frame, 0, 0);
          const timing = panelTiming(audio.duration, comic.panels.length, i);
          await videoSource.add(timing.start, timing.duration, { keyFrame: true });
        } finally {
          frame.close();
        }
        videoProgress = (i + 1) / comic.panels.length;
        report(`Prepared panel ${i + 1} of ${comic.panels.length}. Encoding your audio…`);
      }
      videoSource.close();
    };
    const renderAudio = async () => {
      // Small sequential buffers keep cancellation responsive and avoid a second
      // full-length audio copy. Both tracks run together to respect backpressure.
      const chunkSize = audio.sampleRate;
      for (let offset = 0; offset < audio.length; offset += chunkSize) {
        signal.throwIfAborted();
        const length = Math.min(chunkSize, audio.length - offset);
        const chunk = new AudioBuffer({ length, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate });
        for (let channel = 0; channel < audio.numberOfChannels; channel++) {
          chunk.copyToChannel(audio.getChannelData(channel).subarray(offset, offset + length), channel);
        }
        await audioSource.add(chunk);
        audioProgress = (offset + length) / audio.length;
        report('Encoding your audio and video…');
      }
      audioSource.close();
    };
    await Promise.all([renderPanels(), renderAudio()]);
    signal.throwIfAborted();
    onProgress({ percent: 99, message: 'Finishing MP4 file…' });
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('The video encoder returned an empty file. Your comic is unchanged.');
    complete = true;
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    onProgress({ percent: 100, message: 'Your MP4 is ready.' });
    return { blob, duration: audio.duration, secondsPerPanel: audio.duration / comic.panels.length, codec };
  } finally {
    signal.removeEventListener('abort', abort);
    if (!complete) await output.cancel().catch(() => {});
    canvas.width = canvas.height = 0;
  }
}
