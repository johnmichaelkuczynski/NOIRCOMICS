(() => {
  if (window.__noirAndroidBridgeInstalled) return;
  window.__noirAndroidBridgeInstalled = true;
  const recorders = new Set();
  const streams = new Set();
  const OriginalRecorder = window.MediaRecorder;
  if (OriginalRecorder) {
    window.MediaRecorder = class extends OriginalRecorder {
      constructor(...args) {
        super(...args);
        recorders.add(this);
        this.addEventListener('stop', () => recorders.delete(this), { once: true });
      }
    };
  }
  if (navigator.mediaDevices?.getUserMedia) {
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await originalCapture(constraints);
      streams.add(stream);
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => streams.delete(stream), { once: true });
      }
      return stream;
    };
  }
  window.__noirStopRecording = () => {
    for (const recorder of recorders) {
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (_) {}
      }
    }
    for (const stream of streams) stream.getTracks().forEach(track => track.stop());
    streams.clear();
  };
  document.addEventListener('click', async event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[download]') : null;
    if (!anchor || !window.NoirDownloads || !/^(blob:|data:|https:)/.test(anchor.href)) return;
    event.preventDefault();
    try {
      const response = await fetch(anchor.href);
      if (!response.ok) throw new Error('The download could not be read.');
      const blob = await response.blob();
      if (blob.size > 32 * 1024 * 1024) throw new Error('This download exceeds the 32 MB Android limit.');
      const reader = new FileReader();
      reader.onload = () => window.NoirDownloads.save(
        String(reader.result).split(',')[1], anchor.download || 'Noir-comics-download',
        blob.type || 'application/octet-stream',
      );
      reader.onerror = () => window.NoirDownloads.notify('The download could not be read. Please try again.');
      reader.readAsDataURL(blob);
    } catch (error) {
      window.NoirDownloads.notify(error instanceof Error ? error.message : 'The download failed. Please try again.');
    }
  }, true);
})();
