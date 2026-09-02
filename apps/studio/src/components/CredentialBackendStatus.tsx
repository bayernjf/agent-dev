import { useI18n } from '../i18n/i18n';
import type { CredentialBackendInfo } from '../types';

// Displayed in the local-file note; the daemon owns the real path, this is the human-facing
// location users are told to guard.
const LOCAL_CREDENTIALS_PATH = '~/.agent-dev/credentials.txt';

/**
 * Backend status line plus the storage note of the credentials panel.
 *
 * Extracted from App so the branch contract is testable: an unavailable backend must say so
 * with the reason instead of rendering like a working local store, and the note may only
 * claim Infisical storage when the active backend really is Infisical. Before the daemon
 * answers, `backend` is null and only the historical local-file note renders.
 */
export function CredentialBackendStatus({ backend }: { backend: CredentialBackendInfo | null }) {
  const { t } = useI18n();

  return (
    <>
      {backend && (
        <p className={`credential-backend ${backend.available ? 'connected' : 'unavailable'}`}>
          {backend.available
            ? t('credentials.backendStatus', { type: backend.type })
            : t('credentials.backendUnavailable', { type: backend.type, reason: backend.reason ?? '' })}
        </p>
      )}
      <p className="form-note">
        {backend?.type === 'infisical'
          ? t('credentials.noteInfisical')
          : t('credentials.note', { path: LOCAL_CREDENTIALS_PATH })}
      </p>
    </>
  );
}
