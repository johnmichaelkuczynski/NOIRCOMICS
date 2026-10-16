import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import './character-references.css';

export type CharacterReferenceValue = { characterName: string; instructions?: string; imageDataUri: string };
export type CharacterReferenceItem = CharacterReferenceValue & { id: string };
type Props = { value: CharacterReferenceItem[]; onChange: (v: CharacterReferenceItem[]) => void; disabled: boolean; provider: string; onBusyChange: (busy: boolean) => void };

const MAX = 4;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 12 * 1024 * 1024;

async function toSquareJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); throw new Error('Your browser could not prepare this photo.'); }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const scale = size / Math.max(bitmap.width, bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  const uri = canvas.toDataURL('image/jpeg', 0.84);
  if (!uri.startsWith('data:image/jpeg') || uri.length > 2_000_000) throw new Error('This photo is too large after preparation. Try a different photo.');
  return uri;
}

export function CharacterReferences({ value, onChange, disabled, provider, onBusyChange }: Props) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  const readingRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const locked = disabled || reading;

  function setBusy(b: boolean) { readingRef.current = b; setReading(b); onBusyChange(b); }
  function openPicker(id: string | null) {
    if (readingRef.current) return;
    if (!id && valueRef.current.length >= MAX) { setError('You can attach up to 4 photos. Remove one to add another.'); return; }
    replaceId.current = id;
    input.current?.click();
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    const target = replaceId.current;
    replaceId.current = null;
    if (!files.length || readingRef.current) return;
    setBusy(true);
    const problems: string[] = [];
    let next = [...valueRef.current];
    try {
      const list = target ? files.slice(0, 1) : files;
      if (target && files.length > 1) problems.push('Only one photo can replace this one; extra files were not added.');
      for (const file of list) {
        if (!target && next.length >= MAX) { problems.push(`Only 4 photos are allowed. "${file.name}" and any later files were not added.`); break; }
        if (!TYPES.includes(file.type)) { problems.push(`"${file.name}" is not supported. Use JPEG, PNG, or WebP.`); continue; }
        if (file.size > MAX_BYTES) { problems.push(`"${file.name}" is larger than 12 MB.`); continue; }
        try {
          const imageDataUri = await toSquareJpeg(file);
          if (target) next = next.map(i => i.id === target ? { ...i, imageDataUri } : i);
          else next.push({ id: crypto.randomUUID(), characterName: '', instructions: '', imageDataUri });
        } catch (e) {
          problems.push(e instanceof Error && e.message.includes('too large') ? `"${file.name}": ${e.message}` : `"${file.name}" could not be read as an image.`);
        }
      }
      onChange(next);
    } finally { setBusy(false); }
    setError(problems.join(' '));
  }

  const patch = (id: string, p: Partial<CharacterReferenceValue>) => onChange(value.map(i => i.id === id ? { ...i, ...p } : i));

  return (
    <div className="char-refs">
      <div className="char-refs-head"><span style={{ font: 'inherit', color: 'inherit' }}>Character photos (optional)</span><span data-testid="text-character-photo-count">{value.length} / 4</span></div>
      <p className="usage-note" style={{ marginTop: 0 }}>Photos are sent to the selected image provider for this comic only and are not saved as reusable uploads. They stay in this page until you leave it.{' '}
        {provider === 'venice' ? 'With photos, Venice uses a Seedream multi-image model, which has different image charges.' : provider === 'auto' ? 'With photos, Venice (if chosen automatically) uses a Seedream multi-image model with different image charges; OpenAI keeps its current model.' : 'OpenAI keeps its current model.'}</p>
      {value.length > 0 && (
        <div className="char-ref-list">
          {value.map((item, n) => (
            <div className="char-ref-item" key={item.id} data-testid={`character-reference-${n}`}>
              <img src={item.imageDataUri} alt={`Reference photo ${n + 1}${item.characterName ? ` for ${item.characterName}` : ''}`} />
              <div className="char-ref-fields">
                <input aria-label={`Character name ${n + 1}`} placeholder="Character name (required)" maxLength={80} value={item.characterName} disabled={locked} onChange={e => patch(item.id, { characterName: e.target.value })} />
                <textarea aria-label={`Instructions for photo ${n + 1}`} placeholder="Instructions (optional), e.g. always wears a trench coat" maxLength={300} value={item.instructions ?? ''} disabled={locked} onChange={e => patch(item.id, { instructions: e.target.value })} />
                <div className="char-ref-actions">
                  <button type="button" className="file-button" disabled={locked} onClick={() => openPicker(item.id)}>Replace</button>
                  <button type="button" className="file-button" disabled={locked} onClick={() => { onChange(value.filter(i => i.id !== item.id)); setError(''); }}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="char-ref-add" data-testid="button-add-character-photo" disabled={locked || value.length >= MAX} onClick={() => openPicker(null)}>
        <ImagePlus size={14} /> {reading ? 'Preparing photos…' : value.length >= MAX ? 'Limit of 4 reached' : 'Add photos'}
      </button>
      <input ref={input} className="upload-input" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={pick} data-testid="input-character-photos" />
      {error && <div className="char-ref-error" role="alert">{error}</div>}
    </div>
  );
}
