const sensitiveNamePattern = /(?:token|secret|password|private[_-]?key|api[_-]?key|database[_-]?url)/i;
const commonSecretPattern = /\b(?:sk-[A-Za-z0-9_*.-]{4,}|ghp_[A-Za-z0-9_*.-]{4,}|github_pat_[A-Za-z0-9_*.-]{4,})/g;

export function createAgentEnvironment(source, allowedNames, knownSecrets = []) {
  return Object.fromEntries(
    allowedNames
      .filter(name => {
        if (!Object.hasOwn(source, name) || sensitiveNamePattern.test(name)) return false;
        return !knownSecrets.some(secret => secret && String(source[name]).includes(secret));
      })
      .map(name => [name, source[name]]),
  );
}

export function redactSecrets(value, knownSecrets = []) {
  let redacted = String(value);
  for (const secret of knownSecrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  return redacted.replace(commonSecretPattern, '[REDACTED]');
}

export function assertReference(reference) {
  if (!/^keychain:\/\/agent-dev\/[a-z0-9-]+\/[a-z0-9-]+$/i.test(reference)) {
    throw new Error('secret reference must use the keychain://agent-dev/provider/environment form');
  }
}
