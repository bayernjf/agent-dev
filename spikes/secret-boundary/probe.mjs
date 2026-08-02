import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReference, createAgentEnvironment, redactSecrets } from './boundary.mjs';

const spikeDir = dirname(fileURLToPath(import.meta.url));

function runSecurity(args) {
  const result = spawnSync('security', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`temporary Keychain operation failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function sqlite(databasePath, sql, json = false) {
  const args = json ? ['-json', databasePath, sql] : [databasePath];
  const output = execFileSync('sqlite3', args, {
    encoding: 'utf8',
    input: json ? undefined : sql,
  }).trim();
  return json && output ? JSON.parse(output) : [];
}

function runFixture(filename, environment) {
  const result = spawnSync(process.execPath, [join(spikeDir, filename)], {
    cwd: spikeDir,
    encoding: 'utf8',
    env: environment,
  });
  if (result.status !== 0) {
    throw new Error(`${filename} failed without exposing its environment`);
  }
  return JSON.parse(result.stdout);
}

async function main() {
  const temporaryRoot = join(spikeDir, 'tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'boundary-'));
  const keychainPath = join(temporaryDirectory, 'agent-dev-spike.keychain');
  const databasePath = join(temporaryDirectory, 'state.sqlite');
  const keychainPassword = randomBytes(24).toString('hex');
  const providerSecret = `cloudflare_${randomBytes(32).toString('base64url')}`;
  const service = 'agent-dev-spike-cloudflare';
  const account = 'dev';
  const secretReference = 'keychain://agent-dev/cloudflare/dev';
  let keychainCreated = false;

  try {
    runSecurity(['create-keychain', '-p', keychainPassword, keychainPath]);
    keychainCreated = true;
    runSecurity(['unlock-keychain', '-p', keychainPassword, keychainPath]);
    runSecurity([
      'add-generic-password',
      '-a',
      account,
      '-s',
      service,
      '-w',
      providerSecret,
      keychainPath,
    ]);

    assertReference(secretReference);
    sqlite(
      databasePath,
      `CREATE TABLE secret_bindings (
         provider TEXT NOT NULL,
         environment TEXT NOT NULL,
         secret_ref TEXT NOT NULL,
         PRIMARY KEY (provider, environment)
       ) STRICT;
       INSERT INTO secret_bindings VALUES ('cloudflare', 'dev', '${secretReference}');`,
    );

    const stored = sqlite(databasePath, 'SELECT * FROM secret_bindings;', true)[0];
    assert.equal(stored.secret_ref, secretReference);
    const databaseBytes = await readFile(databasePath);
    assert.equal(databaseBytes.includes(Buffer.from(providerSecret)), false);

    const resolvedSecret = runSecurity([
      'find-generic-password',
      '-a',
      account,
      '-s',
      service,
      '-w',
      keychainPath,
    ]);
    assert.equal(
      createHash('sha256').update(resolvedSecret).digest('hex'),
      createHash('sha256').update(providerSecret).digest('hex'),
      'resolved Keychain value does not match the generated value',
    );

    const providerResult = runFixture('provider-fixture.mjs', {
      PROVIDER_TOKEN: resolvedSecret,
      EXPECTED_TOKEN_SHA256: createHash('sha256').update(providerSecret).digest('hex'),
    });
    assert.equal(providerResult.authorized, true);

    const hostileParentEnvironment = {
      ...process.env,
      AGENT_DEV_RUN_ID: 'secret-boundary-spike',
      PROVIDER_TOKEN: providerSecret,
      DATABASE_URL: 'postgresql://secret.invalid/database',
      PUBLIC_LABEL: `prefix-${providerSecret}`,
    };
    const agentEnvironment = createAgentEnvironment(hostileParentEnvironment, [
      'PATH',
      'HOME',
      'TMPDIR',
      'AGENT_DEV_RUN_ID',
      'PROVIDER_TOKEN',
      'DATABASE_URL',
      'PUBLIC_LABEL',
    ], [providerSecret]);
    const agentResult = runFixture('agent-fixture.mjs', agentEnvironment);
    assert.deepEqual(agentResult.sensitiveNames, []);
    const allowedAgentNames = new Set([
      'AGENT_DEV_RUN_ID',
      'HOME',
      'PATH',
      'TMPDIR',
      '__CF_USER_TEXT_ENCODING',
    ]);
    assert.deepEqual(
      agentResult.visibleNames.filter(name => !allowedAgentNames.has(name)),
      [],
      'agent process received an unexpected environment variable',
    );

    const redactedLog = redactSecrets(
      `provider=${providerSecret} runtime=sk-...masked-token`,
      [providerSecret],
    );
    assert.equal(redactedLog.includes(providerSecret), false);
    assert.equal(redactedLog.includes('masked-token'), false);
    assert.equal(redactSecrets('--skip-domain'), '--skip-domain');

    process.stdout.write(
      `${JSON.stringify(
        {
          keychain: 'temporary isolated keychain verified',
          storedValue: secretReference,
          providerReceivedSecret: providerResult.authorized,
          agentEnvironmentNames: agentResult.visibleNames,
          sensitiveAgentEnvironmentNames: agentResult.sensitiveNames,
          databaseContainsSecret: false,
          logRedaction: 'verified',
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (keychainCreated) runSecurity(['delete-keychain', keychainPath]);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${redactSecrets(error.stack || error.message)}\n`);
  process.exitCode = 1;
});
