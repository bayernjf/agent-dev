import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonAuthHandler, daemonTokenPath, readDaemonToken } from '../dev-proxy-auth';

// Regression coverage for the Studio dev proxy, written after walking the Studio flow on a machine
// that had no ~/.agent-dev/daemon-token yet. `npm run dev` starts the daemon and Vite concurrently,
// and the daemon only mints its token on first start, so the token file appears *after* the dev
// server has loaded its configuration. Any token captured at startup therefore stays empty for the
// whole session and every /api/* route answers 401 with no explanation in the UI.

const FAKE_TOKEN = 'deadbeef'.repeat(8);

/** Stands in for the http-proxy outgoing request; records what would have been sent upstream. */
function recordingRequest() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
  };
}

/** Points the real default read path at a scratch file instead of the caller's home directory. */
async function withTokenPath(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-dev-studio-proxy-'));
  const previous = process.env.AGENT_DEV_DAEMON_TOKEN_PATH;
  process.env.AGENT_DEV_DAEMON_TOKEN_PATH = join(directory, 'daemon-token');
  try {
    await run(process.env.AGENT_DEV_DAEMON_TOKEN_PATH);
  } finally {
    if (previous === undefined) delete process.env.AGENT_DEV_DAEMON_TOKEN_PATH;
    else process.env.AGENT_DEV_DAEMON_TOKEN_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Studio dev proxy authentication', () => {
  it('presents a token that was created after the handler was built', async () => {
    await withTokenPath(async path => {
      const handler = createDaemonAuthHandler();

      // Before the daemon writes the file there is nothing to present, and the proxy must not
      // invent an empty bearer credential.
      const early = recordingRequest();
      handler(early);
      expect(early.headers.has('authorization')).toBe(false);

      // The daemon creates the token while this same dev server keeps running: the next request
      // must carry it without restarting anything.
      await writeFile(path, `${FAKE_TOKEN}\n`, 'utf8');
      const later = recordingRequest();
      handler(later);
      expect(later.headers.get('authorization')).toBe(`Bearer ${FAKE_TOKEN}`);
    });
  });

  it('rereads the file on every request so a rotated token takes effect', async () => {
    await withTokenPath(async path => {
      await writeFile(path, `${FAKE_TOKEN}\n`, 'utf8');
      const handler = createDaemonAuthHandler();

      await writeFile(path, `${'cafebfab'.repeat(8)}\n`, 'utf8');
      const request = recordingRequest();
      handler(request);
      expect(request.headers.get('authorization')).toBe(`Bearer ${'cafebfab'.repeat(8)}`);
    });
  });

  it('strips the trailing newline the daemon writes', async () => {
    await withTokenPath(async path => {
      await writeFile(path, `${FAKE_TOKEN}\n`, 'utf8');
      expect(readDaemonToken()).toBe(FAKE_TOKEN);
    });
  });

  it('reads an absent token as empty rather than throwing', async () => {
    await withTokenPath(async path => {
      expect(readDaemonToken(join(path, '..', 'missing-token'))).toBe('');
    });
  });

  it('honours AGENT_DEV_DAEMON_TOKEN_PATH', async () => {
    await withTokenPath(async path => {
      expect(daemonTokenPath()).toBe(path);
    });
  });
});
