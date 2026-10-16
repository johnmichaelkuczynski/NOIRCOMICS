import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { getGetComicProvidersQueryKey, useGetComicProviders, useWriteComicScript, type ComicGenerationInput, type ComicGenerationInputProvider, type ScriptDraft as Draft } from '@workspace/api-client-react';
import { ArrowUpRight, FileText, Upload, PenLine, RefreshCw } from 'lucide-react';
import { DictationControl } from '@/components/dictation-control';
import { CharacterReferences, type CharacterReferenceItem } from '@/components/character-references';
import { ScriptDraft } from '@/components/script-draft';
import { ComicDownloads } from '@/components/comic-downloads';
import { DevPreviewUsage } from '@/components/dev-preview-usage';
import { errorMessage as getErrorMessage, comicRequestError } from '@/lib/error-message';
import { generateComicInBackground } from '@/lib/comic-job';
import noirStyleImage from '@/assets/noir-style.jpg?inline';
import photoStyleImage from '@/assets/noir-style-without-people.jpg?inline';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

function Home() {
  const [text, setText] = useState('');
  const [panelCount, setPanelCount] = useState(4);
  const [provider, setProvider] = useState<ComicGenerationInputProvider>('openai');
  const [fileName, setFileName] = useState('');
  const [localError, setLocalError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [characterRefs, setCharacterRefs] = useState<CharacterReferenceItem[]>([]);
  const effectiveProvider = characterRefs.length ? 'venice' : provider;
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftIdea, setDraftIdea] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState('');
  const draftRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mutation = useMutation({ mutationFn: ({ data }: { data: ComicGenerationInput }) => generateComicInBackground(data), retry: false });
  const scriptMutation = useWriteComicScript();
  const previousComic = useRef<typeof mutation.data>(undefined);
  const comic = mutation.data || previousComic.current;
  const isGenerating = preparing || mutation.isPending;
  const isBusy = isGenerating || scriptMutation.isPending || dictating || regenerating || preparingPhotos;
  useEffect(() => {
    if (scriptMutation.data) draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scriptMutation.data]);
  const providerStatus = useGetComicProviders({
    query: {
      queryKey: getGetComicProvidersQueryKey(),
      enabled: !isBusy,
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
    await generateFromText(text);
  }

  async function generateFromText(source: string) {
    if (isBusy) return;
    setLocalError('');
    if (!source.trim()) {
      setLocalError('Add a story or essay before generating your comic.');
      return;
    }
    if (source.length > 8000) {
      setLocalError('Keep your source text under 8,000 characters.');
      return;
    }
    if (!Number.isInteger(panelCount) || panelCount < 1 || panelCount > 24) {
      setLocalError('Choose a whole number from 1 to 24 panels.');
      return;
    }
    if (characterRefs.some(r => !r.characterName.trim())) {
      setLocalError('Enter a character name for every attached photo, or remove the photo.');
      return;
    }
    if (characterRefs.length && providerStatus.data?.maxCharacterReferences !== 4) {
      setLocalError('This server has not enabled character photos yet. Publish the updated server and reload before generating with photos. Your photos are unchanged.');
      return;
    }
    const characterReferences = characterRefs.map(r => ({ characterName: r.characterName.trim(), ...(r.instructions?.trim() ? { instructions: r.instructions.trim() } : {}), imageDataUri: r.imageDataUri }));
    let stage: 'style' | 'generation' = 'style';
    try {
      setPreparing(true);
      // Bundle the prepared references with the app. Generation must not depend
      // on another network fetch of the large source PNG or canvas conversion.
      const styleReferenceImage = characterRefs.length ? photoStyleImage : noirStyleImage;
      stage = 'generation';
      const result = await mutation.mutateAsync({
        data: { text: source.trim(), panelCount, styleReferenceImage, provider: effectiveProvider, ...(characterReferences.length ? { characterReferences } : {}) },
      });
      previousComic.current = result;
    } catch (error) {
      setLocalError(comicRequestError(error, stage));
    } finally {
      setPreparing(false);
    }
  }

  async function writeFromIdea() {
    if (isBusy || !text.trim()) return;
    setLocalError('');
    setRegenerationError('');
    if (text.length > 8000 || !Number.isInteger(panelCount) || panelCount < 1 || panelCount > 24) {
      setLocalError('Use up to 8,000 characters and choose a whole number from 1 to 24 panels.');
      return;
    }
    try {
      const originalIdea = text.trim();
      const result = await scriptMutation.mutateAsync({ data: { idea: originalIdea, panelCount } });
      setDraft(result);
      setDraftIdea(originalIdea);
    } catch (error) {
      setLocalError(getErrorMessage(error, 'The script could not be written. Your original idea is unchanged.'));
    }
  }

  async function createNewVersion() {
    if (isBusy || !draft || !draftIdea) return;
    setLocalError('');
    setRegenerationError('');
    if (!Number.isInteger(panelCount) || panelCount < 1 || panelCount > 24) {
      setRegenerationError('Choose a whole number from 1 to 24 panels before creating another version.');
      return;
    }
    setRegenerating(true);
    try {
      const previousScript = draft.script.trim() || scriptMutation.data?.script;
      const result = await scriptMutation.mutateAsync({
        data: { idea: draftIdea, panelCount, ...(previousScript ? { previousScript } : {}) },
      });
      setDraft(result);
    } catch (error) {
      setRegenerationError(getErrorMessage(error, 'The new version could not be written. Your current script is unchanged; try again.'));
    } finally {
      setRegenerating(false);
    }
  }

  function appendDictation(transcript: string) {
    const combined = text ? `${text}${/\s$/.test(text) ? '' : '\n'}${transcript}` : transcript;
    if (combined.length > 8000) throw new Error('This dictation would exceed 8,000 characters. Shorten the existing input, then retry transcription. Your recording is kept on this page.');
    setText(combined);
    setFileName('');
    setLocalError('');
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
            <p>Type, import, or dictate your writing. Have only an idea? Develop it into a script, then choose whether to give it the noir treatment.</p>
          </div>
          <div className="issue-stamp">The writer’s room<br />No. 001 / Original</div>
        </section>

        <div className="workspace">
          <form className="editor-panel" onSubmit={generate}>
            <div className="panel-head">
              <span className="section-label">Your source material</span>
              <button className="file-button" type="button" disabled={isBusy} data-testid="button-clear-page" title="Resets the whole page and removes the current writing and output" onClick={() => window.location.reload()}>
                <RefreshCw size={13} /> Clear page
              </button>
            </div>
            <div className="editor-body">
              {import.meta.env.DEV && <DevPreviewUsage />}
              <div className="field-title">
                <label htmlFor="story-text">Writing or story idea</label>
                <span>UP TO 8,000 CHARACTERS</span>
              </div>
              <textarea
                id="story-text"
                className="source-area"
                data-testid="input-story-text"
                value={text}
                disabled={isBusy}
                onChange={(event) => {
                  setText(event.target.value);
                  setFileName('');
                  if (localError) setLocalError('');
                }}
                placeholder="Paste or dictate your writing, or describe an idea—for example, a man who can read minds and uses his power for insider trading..."
                maxLength={8000}
                aria-describedby="source-foot"
              />
              <div className="source-foot" id="source-foot">
                <button className="file-button" type="button" disabled={isBusy} data-testid="button-upload-file" onClick={() => fileInput.current?.click()}>
                  <Upload size={13} strokeWidth={1.8} />
                  {fileName ? fileName : 'Import .txt or .md'}
                </button>
                <span data-testid="text-character-count">{text.length.toLocaleString()} / 8,000</span>
              </div>
              <input ref={fileInput} className="upload-input" data-testid="input-story-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={readFile} />
              <DictationControl disabled={isGenerating || scriptMutation.isPending || regenerating} onBusyChange={setDictating} onTranscript={appendDictation} />
              <div className="idea-action">
                <button type="button" className="script-write-button" data-testid="button-write-script" disabled={isBusy || !text.trim()} onClick={writeFromIdea}>
                  <PenLine size={15} /> {scriptMutation.isPending ? 'Writing your script…' : 'Write script from idea'}
                </button>
                <p className="usage-note">Develop your idea into an editable script. Making comics afterward is optional.</p>
              </div>

              <div className="divider-label">Frame the story</div>
              <div className="panel-count-row">
                <span className="count-title">Number of panels</span>
                <input className="count-input" aria-label="Number of panels, from 1 to 24" data-testid="input-panel-count" type="number" min={1} max={24} step={1} value={panelCount || ''} disabled={isBusy} onChange={(event) => setPanelCount(Number(event.target.value))} />
              </div>
              <div className="count-grid" role="group" aria-label="Choose number of panels">
                {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={isBusy}
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
                <select id="image-provider" className="provider-select" data-testid="select-image-provider" value={effectiveProvider} disabled={isBusy || characterRefs.length > 0} onChange={(event) => setProvider(event.target.value as ComicGenerationInputProvider)}>
                  <option value="openai">ChatGPT — SFW</option>
                  <option value="venice">Venice — Mature</option>
                  <option value="auto">Automatic</option>
                </select>
              </div>
              <p className="usage-note">{characterRefs.length ? 'Character photos require Venice. Venice reads the photos and generates the comic; no character photos are sent to OpenAI. Remove the photos to choose another provider.' : provider === 'auto' ? 'Automatic uses Venice for non-explicit mature themes and ChatGPT/OpenAI for ordinary content.' : provider === 'venice' ? 'Venice selected for mature, non-explicit themes such as profanity, horror, and non-graphic adult romance.' : 'ChatGPT/OpenAI selected for safe-for-work imagery.'} Explicit sexual content is not supported in either option.</p>
              <p className="provider-status" data-testid="status-venice-connection">{providerStatus.data?.veniceMessage ?? (providerStatus.isError ? 'Could not check Venice connectivity.' : 'Checking Venice connectivity…')}</p>
              <p className="usage-note">Choose 1–24 panels. {characterRefs.length ? 'Photo-assisted comic planning and images use Venice; standalone script writing uses OpenAI.' : 'Script writing uses OpenAI; images use the chosen provider’s balance.'} Dictation uses AssemblyAI. More panels cost more.</p>
              <CharacterReferences value={characterRefs} onChange={setCharacterRefs} disabled={isBusy && !preparingPhotos} onBusyChange={setPreparingPhotos} />
              <div className="ref-note">
                <span className="ref-symbol" aria-hidden="true"><FileText size={15} strokeWidth={1.6} /></span>
                <div><strong>Reference style included</strong>Every frame follows the supplied black-and-white film-noir comic reference.</div>
              </div>
              <button className="generate-btn" type="submit" disabled={isBusy || !text.trim()} data-testid="button-generate-comic">
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
            {scriptMutation.isPending && <div className="script-writing" role="status" data-testid="status-script-writing"><span className="loading-mark" /> {regenerating ? 'Writing a different version from your original idea.' : 'Developing your idea into a complete script.'} No images are being generated.</div>}
            {draft && <div ref={draftRef}><ScriptDraft draft={draft} disabled={isBusy} regenerating={regenerating} regenerationError={regenerationError} onRegenerate={() => { void createNewVersion(); }} onChange={script => setDraft(previous => previous ? { ...previous, script } : previous)} onGenerate={() => { void generateFromText(draft.script); }} /></div>}
            <div className="result-heading">
              <div>
                <h2>Your comic</h2>
                <p>{comic ? `${comic.panels.length} frames · ${comic.providerUsed === 'venice' ? 'Venice AI' : 'ChatGPT/OpenAI'} images` : 'A new sequence is waiting to be made'}</p>
              </div>
              <span className="section-label">02 / 02</span>
            </div>
            {comic && <ComicDownloads comic={comic} disabled={isBusy} />}
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
                        <ComicDownloads comic={{ title: `${comic.title} — Frame ${panel.index}`, panels: [panel] }} disabled={isBusy} panelOnly />
                      </div>
                    </article>
                  ))}
                </div>
                <div className="result-foot"><span>End of sequence</span><span>Keep writing. Keep looking.</span></div>
                <ComicDownloads comic={comic} disabled={isBusy} />
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
