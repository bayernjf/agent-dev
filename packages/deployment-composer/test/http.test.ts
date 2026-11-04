import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from '../src/http.js';

const url = 'https://health.example.test/api/health';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchWithRetry', () => {
  // Review 2026-11-02 P3-7: a 4xx used to be retried like a 5xx, so a
  // permanent 404/401 burned the whole retry budget before reporting the
  // status the server had already sent.
  it('returns a 4xx immediately without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry(url, {}, 3, 0);

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx up to the retry budget', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithRetry(url, {}, 3, 0)).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a network failure and returns the first successful attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry(url, {}, 3, 0);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers when a 5xx becomes a 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('warming up', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry(url, {}, 3, 0);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
