import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { getGetComicProvidersQueryKey, useGenerateComic, useGetComicProviders, type ComicGenerationInputProvider } from '@workspace/api-client-react';
import { ArrowUpRight, FileText, Upload } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

async function loadReferenceAsJpeg(): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}references/film-noir-style.png`);
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
  const [provider, setProvider] = useState<ComicGenerationInputProvider>('openai');
  const [fileName, setFileName] = useState('');
  const [localError, setLocalError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mutation = useGenerateComic();
  const comic = mutation.data;
  const isGenerating = preparing || mutation.isPending;
  const providerStatus = useGetComicProviders({
    query: {
      queryKey: getGetComicProvidersQueryKey(),
      enabled: !isGenerating,
      staleTime: 60_000,
      refetchInterval: 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  });

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
    if (isGenerating) return;
    setLocalError('');
    if (!text.trim()) {
      setLocalError('Add a story or essay before generating your comic.');
      return;
    }
    if (text.length > 8000) {
      setLocalError('Keep your source text under 8,000 characters.');
      return;
    }
    if (!Number.isInteger(panelCount) || panelCount < 1 || panelCount > 24) {
      setLocalError('Choose a whole number from 1 to 24 panels.');
      return;
    }
    try {
      setPreparing(true);
      const styleReferenceImage = await loadReferenceAsJpeg();
      await mutation.mutateAsync({
        data: { text: text.trim(), panelCount, styleReferenceImage, provider },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setLocalError(detail || 'The comic could not be generated. Please try again.');
    } finally {
      setPreparing(false);
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
                disabled={isGenerating}
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
                <button className="file-button" type="button" disabled={isGenerating} data-testid="button-upload-file" onClick={() => fileInput.current?.click()}>
                  <Upload size={13} strokeWidth={1.8} />
                  {fileName ? fileName : 'Import .txt or .md'}
                </button>
                <span data-testid="text-character-count">{text.length.toLocaleString()} / 8,000</span>
              </div>
              <input ref={fileInput} className="upload-input" data-testid="input-story-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={readFile} />

              <div className="divider-label">Frame the story</div>
              <div className="panel-count-row">
                <span className="count-title">Number of panels</span>
                <input className="count-input" aria-label="Number of panels, from 1 to 24" data-testid="input-panel-count" type="number" min={1} max={24} step={1} value={panelCount || ''} disabled={isGenerating} onChange={(event) => setPanelCount(Number(event.target.value))} />
              </div>
              <div className="count-grid" role="group" aria-label="Choose number of panels">
                {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={isGenerating}
                    className={`count-btn${panelCount === count ? ' selected' : ''}`}
                    aria-pressed={panelCount === count}
                    data-testid={`button-panel-count-${count}`}
                    onClick={() => setPanelCount(count)}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <div className="provider-row">
                <label htmlFor="image-provider">Image provider</label>
                <select id="image-provider" className="provider-select" data-testid="select-image-provider" value={provider} disabled={isGenerating} onChange={(event) => setProvider(event.target.value as ComicGenerationInputProvider)}>
                  <option value="openai">ChatGPT — SFW</option>
                  <option value="venice">Venice — Mature</option>
                  <option value="auto">Automatic</option>
                </select>
              </div>
              <p className="usage-note">{provider === 'auto' ? 'Automatic uses Venice for non-explicit mature themes and ChatGPT/OpenAI for ordinary content.' : provider === 'venice' ? 'Venice selected for mature, non-explicit themes such as profanity, horror, and non-graphic adult romance.' : 'ChatGPT/OpenAI selected for safe-for-work imagery.'} Explicit sexual content is not supported in either option.</p>
              <p className="provider-status" data-testid="status-venice-connection">{providerStatus.data?.veniceMessage ?? (providerStatus.isError ? 'Could not check Venice connectivity.' : 'Checking Venice connectivity…')}</p>
              <p className="usage-note">Choose 1–24 panels. Text preparation uses OpenAI; images use the chosen provider’s API balance. More panels cost more.</p>
              <div className="ref-note">
                <span className="ref-symbol" aria-hidden="true"><FileText size={15} strokeWidth={1.6} /></span>
                <div><strong>Reference style included</strong>Every frame follows the supplied black-and-white film-noir comic reference.</div>
              </div>
              <button className="generate-btn" type="submit" disabled={isGenerating || !text.trim()} data-testid="button-generate-comic">
                {isGenerating ? (
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
                <p>{comic ? `${comic.panels.length} frames · ${comic.providerUsed === 'venice' ? 'Venice AI' : 'ChatGPT/OpenAI'} images` : 'A new sequence is waiting to be made'}</p>
              </div>
              <span className="section-label">02 / 02</span>
            </div>
            {isGenerating ? (
              <div className="loading-stage" data-testid="status-generation-loading">
                <div className="loading-copy"><span className="loading-mark" /> Generating your panels. This can take a few minutes.</div>
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
                      <div className="comic-art-frame">
                        <div className="comic-dialogue-space">
                          <div className="speech-balloon">{panel.dialogue}</div>
                        </div>
                        <img className="comic-image" src={panel.imageDataUri} alt={`Panel ${panel.index}: ${panel.visualDescription}`} data-testid={`img-comic-panel-${panel.index}`} />
                      </div>
                      <div className="comic-caption">
                        <div className="caption-top">Frame {String(panel.index).padStart(2, '0')}</div>
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
