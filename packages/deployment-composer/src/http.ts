export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 12,
  retryDelayMs = 10_000,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return response;
      // A 4xx is an answer, not an outage: retrying cannot turn "not found"
      // or "unauthorised" into success, and it only delays the real report
      // (review 2026-11-02 P3-7). Return it so callers can inspect status/body.
      if (response.status >= 400 && response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`Verification failed for ${new URL(url).hostname}: ${lastError?.message ?? 'unknown'}`);
}
