import { Download, ArrowUpRight } from 'lucide-react';
import type { ScriptDraft as Draft } from '@workspace/api-client-react';

type Props = {
  draft: Draft;
  disabled: boolean;
  onChange: (script: string) => void;
  onGenerate: () => void;
};

export function ScriptDraft({ draft, disabled, onChange, onGenerate }: Props) {
  function download() {
    const url = URL.createObjectURL(new Blob([`${draft.title}\n\n${draft.script}`], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${draft.title.replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 80) || 'My script'}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return (
    <section className="script-draft" data-testid="result-script">
      <div className="eyebrow">From idea to script</div>
      <h2>{draft.title}</h2>
      <p>Your script is ready. Edit it, download it, or choose to turn it into noir comics. Your original idea stays in the input.</p>
      <label htmlFor="generated-script" className="script-label">Your editable script</label>
      <textarea id="generated-script" className="source-area script-text" data-testid="input-generated-script" value={draft.script} onChange={event => onChange(event.target.value)} disabled={disabled} maxLength={8000} />
      <div className="script-actions">
        <button type="button" className="file-button" data-testid="button-download-script" onClick={download} disabled={disabled || !draft.script.trim()}><Download size={14} /> Download script</button>
        <span>{draft.script.length.toLocaleString()} / 8,000</span>
      </div>
      <button type="button" className="generate-btn" data-testid="button-comic-from-script" onClick={onGenerate} disabled={disabled || !draft.script.trim()}>Turn this script into comics <ArrowUpRight size={15} /></button>
      <p className="usage-note">Uses your selected panel count and image provider. No images are generated until you choose this action.</p>
    </section>
  );
}
