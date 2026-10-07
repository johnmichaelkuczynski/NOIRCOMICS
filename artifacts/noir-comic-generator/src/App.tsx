import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useGenerateComic } from '@workspace/api-client-react';
import { ArrowUpRight, FileText, Upload } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

async function loadReferenceAsJpeg(): Promise<string> {
  const response = await fetch('/references/film-noir-style.png');
  if (!response.ok) throw new Error('Could not load the noir style reference. Please try again.');
  const bitmap = await createImageBitmap(await response.blob());
  const maxDimension = 1400;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the style reference.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.84);
}

function Home() {
  const [text, setText] = useState('');
  const [panelCount, setPanelCount] = useState(4);
  const [fileName, setFileName] = useState('');
  const [localError, setLocalError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const mutation = useGenerateComic();
  const comic = mutation.data;

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'txt' && ext !== 'md') {
      setLocalError('Choose a .txt or .md file to import.');
      event.target.value = '';
      return;
    }
    try {
      const contents = await file.text();
      if (contents.length > 8000) {
        setLocalError('This text is longer than the 8,000 character limit.');
        return;
      }
      setText(contents);
      setFileName(file.name);
      setLocalError('');
    } catch {
      setLocalError('That file could not be read. Try another .txt or .md file.');
    }
    event.target.value = '';
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    if (!text.trim()) {
      setLocalError('Add a story or essay before generating your comic.');
      return;
    }
    if (text.length > 8000) {
      setLocalError('Keep your source text under 8,000 characters.');
      return;
    }
    try {
      const styleReferenceImage = await loadReferenceAsJpeg();
      await mutation.mutateAsync({
        data: { text: text.trim(), panelCount, styleReferenceImage },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setLocalError(detail || 'The comic could not be generated. Please try again.');
    }
  }

  const errorMessage = localError || (mutation.isError ? 'The comic could not be generated. Please try again.' : '');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">N°</div>
          <span className="brand-name">Noir Comic Generator</span>
        </div>
        <div className="top-note">A story, in shadows &amp; light</div>
      </header>

      <main className="main-wrap">
        <section className="masthead">
          <div>
            <div className="eyebrow">From page to panel</div>
            <h1>Give your story<br />the noir treatment.</h1>
            <p>Turn a short piece of writing into a cinematic black-and-white comic. Your words stay at the heart of every frame.</p>
          </div>
          <div className="issue-stamp">The writer’s room<br />No. 001 / Original</div>
        </section>

        <div className="workspace">
          <form className="editor-panel" onSubmit={generate}>
            <div className="panel-head">
              <span className="section-label">Your source material</span>
              <span className="step-no">01 / 02</span>
            </div>
            <div className="editor-body">
              <div className="field-title">
                <label htmlFor="story-text">Story or essay</label>
                <span>UP TO 8,000 CHARACTERS</span>
              </div>
              <textarea
                id="story-text"
                className="source-area"
                data-testid="input-story-text"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setFileName('');
                  if (localError) setLocalError('');
                }}
                placeholder="Paste a compact story, scene, or essay here. The generator will preserve its meaning as it finds the frames..."
                maxLength={8000}
                aria-describedby="source-foot"
              />
              <div className="source-foot" id="source-foot">
                <button className="file-button" type="button" data-testid="button-upload-file" onClick={() => fileInput.current?.click()}>
                  <Upload size={13} strokeWidth={1.8} />
                  {fileName ? fileName : 'Import .txt or .md'}
                </button>
                <span data-testid="text-character-count">{text.length.toLocaleString()} / 8,000</span>
              </div>
              <input ref={fileInput} className="upload-input" data-testid="input-story-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={readFile} />

              <div className="divider-label">Frame the story</div>
              <div className="panel-count-row">
                <span className="count-title">Number of panels</span>
                <span className="count-current" data-testid="text-panel-count">{String(panelCount).padStart(2, '0')} PANELS</span>
              </div>
              <div className="count-grid" role="group" aria-label="Choose number of panels">
                {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`count-btn${panelCount === count ? ' selected' : ''}`}
                    aria-pressed={panelCount === count}
                    data-testid={`button-panel-count-${count}`}
                    onClick={() => setPanelCount(count)}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <div className="ref-note">
                <span className="ref-symbol" aria-hidden="true"><FileText size={15} strokeWidth={1.6} /></span>
                <div><strong>Reference style included</strong>Every frame follows the supplied black-and-white film-noir comic reference.</div>
              </div>
              <button className="generate-btn" type="submit" disabled={mutation.isPending || !text.trim()} data-testid="button-generate-comic">
                {mutation.isPending ? (
                  <>Developing your panels <span className="loading-mark" aria-hidden="true" /></>
                ) : (
                  <>Generate comic <ArrowUpRight size={15} strokeWidth={1.8} /></>
                )}
              </button>
              {errorMessage && <div className="error-box" role="alert" data-testid="status-generation-error">{errorMessage}</div>}
            </div>
          </form>

          <section className="result-area" aria-live="polite">
            <div className="result-heading">
              <div>
                <h2>Your comic</h2>
                <p>{comic ? `${comic.panels.length} frames · generated from your text` : 'A new sequence is waiting to be made'}</p>
              </div>
              <span className="section-label">02 / 02</span>
            </div>
            {mutation.isPending ? (
              <div className="loading-stage" data-testid="status-generation-loading">
                <div className="loading-copy"><span className="loading-mark" /> In the darkroom — developing your story</div>
                <div className="skeleton-grid">
                  {Array.from({ length: Math.min(panelCount, 4) }, (_, index) => (
                    <div className="skeleton-card" key={index} aria-hidden="true"><div className="skeleton-image" /><div className="skeleton-line" /></div>
                  ))}
                </div>
              </div>
            ) : comic ? (
              <div data-testid="result-comic">
                <h3 className="comic-title" data-testid="text-comic-title">{comic.title}</h3>
                <div className="comic-grid">
                  {comic.panels.map((panel, index) => (
                    <article className="comic-card" key={`${panel.index}-${index}`} data-testid={`card-comic-panel-${panel.index}`} style={{ animationDelay: `${index * 70}ms` }}>
                      <img className="comic-image" src={panel.imageDataUri} alt={`Panel ${panel.index}: ${panel.visualDescription}`} data-testid={`img-comic-panel-${panel.index}`} />
                      <div className="comic-caption">
                        <div className="caption-top">Frame {String(panel.index).padStart(2, '0')}</div>
                        <div className="visual-description">{panel.visualDescription}</div>
                        {panel.dialogue && <div className="dialogue">{panel.dialogue}</div>}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="result-foot"><span>End of sequence</span><span>Keep writing. Keep looking.</span></div>
              </div>
            ) : (
              <div className="empty-stage" data-testid="empty-comic-state">
                <div className="empty-art" aria-hidden="true" />
                <h3>Every frame starts with a line.</h3>
                <p>Write or import your source on the left, choose how many panels it needs, then let the story unfold.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
