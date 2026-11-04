import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../src/lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  // Review 2026-11-02 P3-2: a stalled daemon must abort instead of leaving the
  // Studio request pending forever.
  it('aborts when the server never answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ),
    );

    await expect(apiFetch('/api/projects', {}, 30)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('passes method and body through untouched', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/projects/p1/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"confirm":true}',
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"confirm":true}');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
