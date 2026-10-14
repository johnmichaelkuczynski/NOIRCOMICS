import { useQuery } from '@tanstack/react-query';

export function DevPreviewUsage() {
  const { data, error } = useQuery({
    queryKey: ['desktop-preview-usage'],
    queryFn: async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}api/billing/usage`, { cache: 'no-store' });
      const value = await response.json();
      if (!response.ok || value.desktop !== true || value.unrestricted !== true) throw new Error(value.error || 'PC generation could not be checked.');
      return value as { desktop: true; unrestricted: true };
    },
    refetchInterval: 15_000,
    retry: false,
  });
  return (
    <p className="usage-note" role="status" data-testid="status-dev-preview-usage">
      {data ? 'PC generation is ready. No subscription or Android setup required.'
        : error ? (error instanceof Error ? error.message : 'Preview usage is unavailable.')
          : 'Checking desktop preview usage…'}
    </p>
  );
}
