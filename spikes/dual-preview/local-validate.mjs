import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './fixture/api/api/health.mjs';

const spikeDir = fileURLToPath(new URL('.', import.meta.url));
const allowedOrigin = 'https://spike.example.pages.dev';
process.env.ALLOWED_ORIGIN = allowedOrigin;

function invoke(origin) {
  const headers = new Map();
  let statusCode = null;
  let body = null;
  handler(
    { headers: { origin } },
    {
      setHeader: (name, value) => headers.set(name.toLowerCase(), value),
      status: code => {
        statusCode = code;
        return {
          json: value => {
            body = value;
          },
        };
      },
    },
  );
  return { headers, statusCode, body };
}

const allowed = invoke(allowedOrigin);
assert.equal(allowed.statusCode, 200);
assert.equal(allowed.headers.get('access-control-allow-origin'), allowedOrigin);
assert.equal(allowed.headers.get('vary'), 'Origin');
assert.equal(allowed.body.ok, true);

const rejected = invoke('https://untrusted.example');
assert.equal(rejected.headers.has('access-control-allow-origin'), false);

const frontend = await readFile(join(spikeDir, 'fixture/frontend/index.html'), 'utf8');
assert.equal(frontend.includes('__API_BASE_URL__'), true);
assert.equal(frontend.includes("fetch(`${apiBaseUrl}/api/health`)"), true);

process.stdout.write(
  `${JSON.stringify({ apiHealth: 'ok', exactCors: 'ok', frontendInjectionPoint: 'ok' }, null, 2)}\n`,
);
