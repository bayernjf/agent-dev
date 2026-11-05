import { PassThrough } from 'node:stream';
import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server';

// `renderToString` is a synchronous API: it cannot wait for a Suspense boundary, so any `React.lazy`
// panel would make the shell assertion see only the fallback. Streaming with `onAllReady` waits for
// every boundary to finish before the HTML is collected, which keeps the full-page assertions intact
// while letting those panels be code-split.
export function renderAsync(node: ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = '';
    const stream = new PassThrough();
    stream.on('data', chunk => { html += String(chunk); });
    stream.on('end', () => resolve(html));
    stream.on('error', reject);
    const { pipe } = renderToPipeableStream(node, {
      onAllReady() { pipe(stream); },
      onShellError(error) { reject(error); },
      onError(error) { reject(error); },
    });
  });
}
