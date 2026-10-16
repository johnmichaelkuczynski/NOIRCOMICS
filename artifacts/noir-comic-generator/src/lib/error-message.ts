export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as { error?: unknown } | undefined;
    if (data && typeof data.error === 'string') return data.error;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function comicRequestError(error: unknown, stage: 'style' | 'generation'): string {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
  if (stage === 'generation' && [502, 503, 504].includes(status)) {
    const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined;
    // Preserve real server errors, but never dump a gateway's HTML into the UI.
    if (!data || typeof data !== 'object' || !('error' in data)) {
      return `The connection gateway returned HTTP ${status}. The server may still be generating. Your writing and photos remain on this page. Do not immediately resubmit.`;
    }
  }
  const message = errorMessage(error, 'The comic could not be generated. Please try again.');
  if (!/^(failed to fetch|fetch failed|networkerror.*|load failed)$/i.test(message)) return message;
  return stage === 'style'
    ? 'The browser could not load the included noir style image. No comic generation request was sent. Your writing and photos are still on this page.'
    : 'The browser lost its connection to the comic server or could not reach it. No result was received; the server may still be generating. Your writing and photos are still on this page. Do not immediately resubmit: another request could generate and charge for a second comic.';
}
