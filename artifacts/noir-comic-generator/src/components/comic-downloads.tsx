import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadComicPng, downloadPrintableComic, downloadFrame, downloadSeparateFrames, type DownloadableComic } from '@/lib/download-comic';

export function ComicDownloads({ comic, disabled, panelOnly = false }: { comic: DownloadableComic; disabled: boolean; panelOnly?: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  async function download(format: 'png' | 'printable' | 'frames') {
    if (downloading || disabled) return;
    setDownloading(true);
    setError('');
    try {
      if (format === 'frames') await downloadSeparateFrames(comic);
      else if (format === 'png') {
        if (panelOnly) await downloadFrame(comic);
        else await downloadComicPng(comic);
      } else downloadPrintableComic(comic);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Download failed. Your comic is still on this page.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="comic-downloads">
      <div className="comic-download-buttons">
        <button className="voice-button" type="button" data-testid="button-download-comic" disabled={disabled || downloading} onClick={() => { void download('png'); }}>
          <Download size={15} /> {downloading ? 'Preparing download…' : panelOnly ? `Download frame ${comic.panels[0].index}` : 'Download all panels PNG'}
        </button>
        {!panelOnly && <button className="voice-button" type="button" data-testid="button-download-separate-frames" disabled={disabled || downloading} onClick={() => { void download('frames'); }}>
          <Download size={15} /> Download separate frames ZIP
        </button>}
        {!panelOnly && <button className="voice-button" type="button" data-testid="button-download-printable-comic" disabled={disabled || downloading} onClick={() => { void download('printable'); }}>
          <Download size={15} /> Download printable comic
        </button>}
      </div>
      {!panelOnly && <p className="usage-note">All downloads include the dialogue. For video, choose separate frames: the ZIP contains one numbered 1024 × 1536 PNG per frame, without page titles or captions. The printable file opens offline.</p>}
      {error && <div className="error-box" role="alert" data-testid="status-download-error">{error}</div>}
    </div>
  );
}
