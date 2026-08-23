export async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 12): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new Error(`Verification failed for ${new URL(url).hostname}: ${lastError?.message ?? 'unknown'}`);
}
