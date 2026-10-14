export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as { error?: unknown } | undefined;
    if (data && typeof data.error === 'string') return data.error;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
