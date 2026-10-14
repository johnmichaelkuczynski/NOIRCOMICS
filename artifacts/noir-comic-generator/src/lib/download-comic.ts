import { zipSync } from 'fflate';

export type DownloadableComic = {
  title: string;
  panels: { index: number; dialogue: string; imageDataUri: string }[];
};

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && context.measureText(`${line} ${word}`).width > width) {
        lines.push(line);
        line = '';
      }
      // Break exceptionally long words instead of clipping any dialogue.
      for (const character of word) {
        const next = line + character;
        if (context.measureText(next).width > width && line) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
      line += ' ';
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => reject(new Error('An image could not be prepared. Your comic is still on this page; try downloading again.')), 30_000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('An image could not be loaded. Your comic has not been cleared.')); };
    image.src = source;
  });
}

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function filename(title: string) {
  return title.replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 80) || 'Noir comic';
}

export async function downloadComicPng(comic: DownloadableComic) {
  if (!comic.panels.length) throw new Error('Generate a comic before downloading.');
  const images = await Promise.all(comic.panels.map(panel => loadImage(panel.imageDataUri)));
  const canvas = document.createElement('canvas');
  canvas.width = comic.panels.length === 1 ? 656 : 1280;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image export is unavailable in this browser. Use Download printable comic instead.');
  context.font = 'bold 40px Georgia, serif';
  const titleLines = wrapText(context, comic.title, canvas.width - 56);
  const headerHeight = titleLines.length * 48 + 74;
  context.font = '24px Georgia, serif';
  const dialogues = comic.panels.map(panel => wrapText(context, panel.dialogue, 532));
  const heights = dialogues.map(lines => Math.max(64, lines.length * 30 + 32) + 16 + 900 + 64);
  let height = headerHeight + 28;
  for (let i = 0; i < heights.length; i += 2) height += Math.max(heights[i], heights[i + 1] || 0) + 24;
  // A printable self-contained copy remains available on constrained browsers.
  if (height > 30_000) throw new Error('This comic is too tall for one PNG. Use Download printable comic to save every panel and all dialogue.');
  canvas.height = height;
  context.fillStyle = '#e9e5dc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#202226';
  context.font = 'bold 40px Georgia, serif';
  context.textBaseline = 'top';
  titleLines.forEach((line, i) => context.fillText(line, 28, 28 + i * 48));
  context.font = '18px monospace';
  context.fillStyle = '#6d6a64';
  context.fillText(`${comic.panels.length} frames · Noir Comic Generator`, 28, 38 + titleLines.length * 48);
  let y = headerHeight;
  for (let i = 0; i < comic.panels.length; i += 2) {
    const rowHeight = Math.max(heights[i], heights[i + 1] || 0);
    for (let j = i; j < Math.min(i + 2, comic.panels.length); j++) {
      const x = 28 + (j % 2) * 624;
      const dialogueHeight = Math.max(64, dialogues[j].length * 30 + 32);
      context.fillStyle = '#f7f4ed';
      context.fillRect(x, y, 600, heights[j]);
      context.fillStyle = '#111';
      context.fillRect(x + 8, y + 8, 584, dialogueHeight + 916);
      context.fillStyle = '#fff';
      context.beginPath();
      context.roundRect(x + 20, y + 16, 560, dialogueHeight, 24);
      context.fill();
      context.beginPath();
      context.moveTo(x + 150, y + 16 + dialogueHeight);
      context.lineTo(x + 168, y + 16 + dialogueHeight);
      context.lineTo(x + 150, y + 30 + dialogueHeight);
      context.fill();
      context.fillStyle = '#080808';
      context.font = '24px Georgia, serif';
      context.textAlign = 'center';
      dialogues[j].forEach((line, n) => context.fillText(line, x + 300, y + 32 + n * 30));
      const image = images[j];
      const scale = Math.min(584 / image.naturalWidth, 900 / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const imageHeight = image.naturalHeight * scale;
      context.filter = 'grayscale(1)';
      context.drawImage(image, x + 8 + (584 - width) / 2, y + dialogueHeight + 24 + (900 - imageHeight) / 2, width, imageHeight);
      context.filter = 'none';
      context.textAlign = 'left';
      context.fillStyle = '#a43b31';
      context.font = '16px monospace';
      context.fillText(`FRAME ${String(comic.panels[j].index).padStart(2, '0')}`, x + 20, y + dialogueHeight + 944);
    }
    y += rowHeight + 24;
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Your browser could not export this PNG. Use Download printable comic instead.')), 'image/png');
  });
  saveFile(blob, `${filename(comic.title)}.png`);
  canvas.width = canvas.height = 0;
}

async function createFramePng(panel: DownloadableComic['panels'][number]): Promise<Blob> {
  const image = await loadImage(panel.imageDataUri);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1536;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the frame.');
  let fontSize = 32;
  let lines: string[];
  do {
    context.font = `${fontSize}px Georgia, serif`;
    lines = wrapText(context, panel.dialogue, 904);
    if (lines.length * fontSize * 1.3 + 56 <= 700) break;
    fontSize -= 2;
  } while (fontSize >= 16);
  const lineHeight = Math.ceil(fontSize * 1.3);
  const dialogueHeight = Math.max(100, lines!.length * lineHeight + 48);
  if (dialogueHeight > 700) throw new Error('This frame contains too much dialogue for a video-sized PNG. Use Download printable comic to preserve all its text.');
  context.fillStyle = '#111';
  context.fillRect(0, 0, 1024, 1536);
  context.fillStyle = '#fff';
  context.beginPath();
  context.roundRect(32, 16, 960, dialogueHeight, 32);
  context.fill();
  context.beginPath();
  context.moveTo(240, 16 + dialogueHeight);
  context.lineTo(264, 16 + dialogueHeight);
  context.lineTo(240, 38 + dialogueHeight);
  context.fill();
  context.font = `${fontSize}px Georgia, serif`;
  context.fillStyle = '#080808';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  lines!.forEach((line, i) => context.fillText(line, 512, 40 + i * lineHeight));
  const top = dialogueHeight + 48;
  const scale = Math.min(1024 / image.naturalWidth, (1536 - top) / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.filter = 'grayscale(1)';
  context.drawImage(image, (1024 - width) / 2, top + (1536 - top - height) / 2, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Frame export failed. Your comic is unchanged.')), 'image/png');
  });
  canvas.width = canvas.height = 0;
  return blob;
}

export async function downloadFrame(comic: DownloadableComic) {
  const panel = comic.panels[0];
  if (!panel) throw new Error('No frame is available.');
  saveFile(await createFramePng(panel), `${filename(comic.title)}.png`);
}

export async function downloadSeparateFrames(comic: DownloadableComic) {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < comic.panels.length; i++) {
    const panel = comic.panels[i];
    const blob = await createFramePng(panel);
    files[`frame-${String(i + 1).padStart(2, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
  }
  const zip = zipSync(files, { level: 0 });
  saveFile(new Blob([new Uint8Array(zip).buffer], { type: 'application/zip' }), `${filename(comic.title)} - separate frames.zip`);
}

export function downloadPrintableComic(comic: DownloadableComic) {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
  const panels = comic.panels.map(panel => {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(panel.imageDataUri)) {
      throw new Error('This panel cannot be embedded safely. Use Download comic PNG instead.');
    }
    return `<article><div class="art"><div class="dialogue"><div class="balloon">${escape(panel.dialogue)}</div></div><img src="${panel.imageDataUri}" alt="Frame ${panel.index}"></div><footer>FRAME ${panel.index}</footer></article>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(comic.title)}</title><style>
body{margin:28px;background:#e9e5dc;color:#202226;font-family:Georgia,serif}h1{font-size:36px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;max-width:1280px}article{padding:8px;background:#f7f4ed;border:1px solid #b9b2a7;break-inside:avoid}.art{background:#111;border:2px solid #111}.dialogue{padding:8px 10px 16px;display:flex;justify-content:center}.balloon{padding:10px 14px;border-radius:24px;background:white;color:#080808;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.3;position:relative}.balloon:after{content:"";position:absolute;left:23%;bottom:-10px;border-top:12px solid white;border-right:12px solid transparent}img{display:block;width:100%;aspect-ratio:2/3;object-fit:contain;filter:grayscale(1)}footer{padding:14px;color:#a43b31;font:12px monospace}@media(max-width:600px){.grid{grid-template-columns:1fr}}@media print{body{margin:0;background:white}.grid{gap:12px}h1{font-size:24px}article{box-shadow:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><h1>${escape(comic.title)}</h1><p>${comic.panels.length} frames · Noir Comic Generator</p><div class="grid">${panels}</div></body></html>`;
  saveFile(new Blob([html], { type: 'text/html;charset=utf-8' }), `${filename(comic.title)}.html`);
}
