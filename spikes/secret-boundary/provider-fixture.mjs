import { createHash } from 'node:crypto';

const actualHash = createHash('sha256').update(process.env.PROVIDER_TOKEN || '').digest('hex');
const authorized = actualHash === process.env.EXPECTED_TOKEN_SHA256;

process.stdout.write(`${JSON.stringify({ authorized })}\n`);
process.exitCode = authorized ? 0 : 1;
