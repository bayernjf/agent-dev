import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { ArrowRight, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { CredentialBackendStatus } from '../components/CredentialBackendStatus';
import { formatDate } from '../lib/utils';
import type {
  CredentialBackendInfo, CredentialMeta, CredentialVerifyResult, ProjectResources,
} from '../types';

export type SupabaseInputs = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type CredentialsViewProps = {
  credentialBackend: CredentialBackendInfo | null;
  credentialMeta: CredentialMeta | null;
  credentialInputs: Record<string, string>;
  setCredentialInputs: Dispatch<SetStateAction<Record<string, string>>>;
  verifyResults: CredentialVerifyResult[];
  guideMode: boolean;
  setGuideMode: Dispatch<SetStateAction<boolean>>;
  guideStep: number;
  setGuideStep: Dispatch<SetStateAction<number>>;
  savingCredentials: boolean;
  verifying: boolean;
  supabaseInputs: SupabaseInputs;
  setSupabaseInputs: Dispatch<SetStateAction<SupabaseInputs>>;
  newCustomKey: string;
  setNewCustomKey: Dispatch<SetStateAction<string>>;
  newCustomValue: string;
  setNewCustomValue: Dispatch<SetStateAction<string>>;
  projectResources: ProjectResources;
  hasSelectedProject: boolean;
  regeneratingEnv: boolean;
  onSaveCredentialValues: () => Promise<void>;
  onVerifyAllCredentials: () => Promise<void>;
  onSaveSupabaseManual: () => Promise<void>;
  onAddCustomKey: () => Promise<void>;
  onDeleteCredential: (key: string) => Promise<void>;
  onRegenerateEnv: () => Promise<void>;
};

// The credentials view is a navigation-only panel: it is never part of the first screen, so it lives
// in its own module and is loaded on demand (see the lazy import in App.tsx). Keeping the provider
// labels here also keeps their translation lookups out of the initial bundle.
export default function CredentialsView({
  credentialBackend,
  credentialMeta,
  credentialInputs,
  setCredentialInputs,
  verifyResults,
  guideMode,
  setGuideMode,
  guideStep,
  setGuideStep,
  savingCredentials,
  verifying,
  supabaseInputs,
  setSupabaseInputs,
  newCustomKey,
  setNewCustomKey,
  newCustomValue,
  setNewCustomValue,
  projectResources,
  hasSelectedProject,
  regeneratingEnv,
  onSaveCredentialValues,
  onVerifyAllCredentials,
  onSaveSupabaseManual,
  onAddCustomKey,
  onDeleteCredential,
  onRegenerateEnv,
}: CredentialsViewProps) {
  const { t, locale } = useI18n();

  const providerFields = useMemo(() => [
    { key: 'GITHUB_TOKEN' as const, label: t('credentials.provider.github.label'), tutorial: 'https://github.com/settings/tokens', hint: t('credentials.provider.github.hint'), providerId: 'github' as const },
    { key: 'VERCEL_TOKEN' as const, label: t('credentials.provider.vercel.label'), tutorial: 'https://vercel.com/account/tokens', hint: t('credentials.provider.vercel.hint'), providerId: 'vercel' as const },
    { key: 'CLOUDFLARE_API_TOKEN' as const, label: t('credentials.provider.cloudflare.label'), tutorial: 'https://dash.cloudflare.com/profile/api-tokens', hint: t('credentials.provider.cloudflare.hint'), providerId: 'cloudflare' as const },
    { key: 'SUPABASE_ACCESS_TOKEN' as const, label: t('credentials.provider.supabase.label'), tutorial: 'https://supabase.com/dashboard/account/tokens', hint: t('credentials.provider.supabase.hint'), providerId: 'supabase' as const },
  ], [t]);

  return (
    <section className="credential-panel" id="credentials">
      <div className="panel-title"><div><p className="eyebrow">{t('common.localOnly')}</p><h2>{t('credentials.title')}</h2></div><KeyRound size={19} aria-hidden="true" /></div>
      <CredentialBackendStatus backend={credentialBackend} />

      {guideMode && credentialMeta?.keys.length === 0 && (
        <div className="credential-guide">
          <div className="guide-progress">
            <span>{t('credentials.step', { current: guideStep + 1, total: providerFields.length })}</span>
            <button className="guide-skip-button" type="button" onClick={() => setGuideMode(false)}>{t('credentials.skipGuide')}</button>
          </div>
          {providerFields.map((field, index) => (
            <div className={`guide-step ${index === guideStep ? 'active' : index < guideStep ? 'done' : ''}`} key={field.key}>
              <div className="guide-step-header">
                <strong>{field.label}</strong>
                {index < guideStep && credentialInputs[field.key] ? <span className="verify-status valid">{t('common.filled')}</span> : null}
              </div>
              {index === guideStep && <>
                <small>{field.hint}</small>
                <a href={field.tutorial} target="_blank" rel="noopener noreferrer">{t('credentials.howToGetToken')}</a>
                <input type="password" className="credential-input" value={credentialInputs[field.key] ?? ''} onChange={event => setCredentialInputs(current => ({ ...current, [field.key]: event.target.value }))} placeholder={`${t('credentials.paste')} ${field.label}`} />
                <div className="guide-step-actions">
                  {guideStep > 0 && <button className="secondary-button" type="button" onClick={() => setGuideStep(guideStep - 1)}>{t('common.back')}</button>}
                  {guideStep < providerFields.length - 1
                    ? <button className="primary-button" type="button" onClick={() => setGuideStep(guideStep + 1)}>{t('common.next')}</button>
                    : <button className="primary-button" type="button" onClick={() => { setGuideMode(false); void onSaveCredentialValues(); }}>{t('credentials.saveAll')}</button>}
                </div>
              </>}
            </div>
          ))}
        </div>
      )}

      {!guideMode && <>
        <div className="credential-list">
          {providerFields.map(field => {
            const connected = credentialMeta?.keys.includes(field.key) ?? false;
            const verifyResult = verifyResults.find(r => r.providerId === field.providerId);
            return (
              <article className="credential-item" key={field.key}>
                <div className="credential-header">
                  <strong>{field.label}</strong>
                  <span className={`credential-status ${connected ? 'connected' : 'missing'}`}>{connected ? t('common.connected') : t('common.notSet')}</span>
                  {verifyResult && <span className={`verify-status ${verifyResult.status}`}>{verifyResult.status === 'valid' ? t('common.valid') : verifyResult.status === 'invalid' ? t('common.invalid') : t('common.notApplicable')}</span>}
                </div>
                <small className="credential-hint">{field.hint}</small>
                <a className="credential-tutorial" href={field.tutorial} target="_blank" rel="noopener noreferrer">{t('credentials.howToGetToken')}</a>
                {connected ? (
                  <button className="quiet-button credential-delete" type="button" onClick={() => void onDeleteCredential(field.key)}>{t('common.delete')}</button>
                ) : (
                  <input
                    type="password"
                    className="credential-input"
                    value={credentialInputs[field.key] ?? ''}
                    onChange={event => setCredentialInputs(current => ({ ...current, [field.key]: event.target.value }))}
                    placeholder={`${t('credentials.paste')} ${field.label}`}
                  />
                )}
              </article>
            );
          })}
        </div>
        <div className="credential-actions-row">
          <button className="primary-button" type="button" onClick={() => void onSaveCredentialValues()} disabled={savingCredentials}>
            {savingCredentials ? t('credentials.saving') : t('credentials.saveToLocal')}
            <KeyRound size={15} aria-hidden="true" />
          </button>
          <button className="secondary-button" type="button" onClick={() => void onVerifyAllCredentials()} disabled={verifying}>
            {verifying ? t('credentials.verifying') : t('credentials.verifyCredentials')}
            <ShieldCheck size={15} aria-hidden="true" />
          </button>
        </div>
        {verifyResults.length > 0 && (
          <div className="verify-results">
            {verifyResults.map(result => (
              <div className={`verify-item ${result.status}`} key={result.providerId}>
                <strong>{result.providerId}</strong>
                <span>{result.status}</span>
                <small>{result.detail}</small>
              </div>
            ))}
          </div>
        )}

        {/* Supabase Manual Setup */}
        <div className="supabase-manual">
          <div className="section-heading"><div><p className="eyebrow">{t('credentials.manualSetup')}</p><h3>{t('credentials.supabaseConfiguration')}</h3></div></div>
          <p className="form-note">{t('credentials.supabaseDescription')}</p>
          <ol className="supabase-steps">
            <li>{t('credentials.supabaseStep1Before')}<a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">{t('credentials.supabaseDashboard')}</a>{t('credentials.supabaseStep1After')}</li>
            <li>{t('credentials.supabaseStep2')}</li>
            {/* Deliberately 4 before 3: the dashboard navigation has to happen before the values can
                be copied, even though the keys were named in the other order. */}
            <li>{t('credentials.supabaseStep4')}</li>
            <li>{t('credentials.supabaseStep3')}</li>
          </ol>
          <div className="supabase-inputs">
            <label htmlFor="supabase-url">{t('credentials.projectUrl')}</label>
            <input id="supabase-url" className="credential-input" value={supabaseInputs.SUPABASE_URL} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_URL: event.target.value }))} placeholder={t('credentials.urlPlaceholder')} />
            <label htmlFor="supabase-anon">{t('credentials.anonPublicKey')}</label>
            <input id="supabase-anon" className="credential-input" value={supabaseInputs.SUPABASE_ANON_KEY} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_ANON_KEY: event.target.value }))} placeholder={t('credentials.keyPlaceholder')} />
            <label htmlFor="supabase-service">{t('credentials.serviceRoleKey')}</label>
            <input id="supabase-service" className="credential-input" value={supabaseInputs.SUPABASE_SERVICE_ROLE_KEY} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_SERVICE_ROLE_KEY: event.target.value }))} placeholder={t('credentials.keyPlaceholder')} />
            <button className="secondary-button" type="button" onClick={() => void onSaveSupabaseManual()} disabled={savingCredentials}>{savingCredentials ? t('credentials.saving') : t('credentials.saveSupabaseConfig')}<KeyRound size={14} aria-hidden="true" /></button>
          </div>
        </div>

        {/* Custom API Keys */}
        <div className="custom-key-section">
          <div className="section-heading"><div><p className="eyebrow">{t('credentials.thirdParty')}</p><h3>{t('credentials.customApiKeys')}</h3></div></div>
          {credentialMeta?.keys.filter(key => !providerFields.some(f => f.key === key)).map(key => (
            <article className="credential-item" key={key}>
              <div className="credential-header">
                <strong>{key}</strong>
                <span className="credential-status connected">{t('credentials.configured')}</span>
              </div>
              <button className="quiet-button credential-delete" type="button" onClick={() => void onDeleteCredential(key)}>{t('common.delete')}</button>
            </article>
          ))}
          <div className="custom-key-form">
            <label htmlFor="custom-key-name">{t('credentials.keyNameLabel')}</label>
            <input id="custom-key-name" value={newCustomKey} onChange={event => setNewCustomKey(event.target.value)} placeholder={t('credentials.keyNamePlaceholder')} maxLength={60} />
            <label htmlFor="custom-key-value">{t('credentials.valueLabel')}</label>
            <input id="custom-key-value" type="password" value={newCustomValue} onChange={event => setNewCustomValue(event.target.value)} placeholder={t('credentials.valuePlaceholder')} maxLength={200} />
            <button className="secondary-button" type="button" onClick={() => void onAddCustomKey()} disabled={savingCredentials}>{savingCredentials ? t('credentials.saving') : t('credentials.addCustomKey')}<ArrowRight size={14} aria-hidden="true" /></button>
          </div>
        </div>
      </>}

      {credentialMeta?.updatedAt && <small className="credential-updated">{t('credentials.lastUpdated', { date: formatDate(credentialMeta.updatedAt, locale) })}</small>}
      {hasSelectedProject && projectResources && (
        <div className="credential-resources">
          <p className="eyebrow">{t('credentials.projectResources')}</p>
          <div className="resource-list">
            {Object.entries(projectResources.providers).map(([providerId, state]) => (
              <article className="resource-item" key={providerId}>
                <strong>{providerId}</strong>
                <code>{'url' in state ? String(state.url) : 'projectId' in state ? String(state.projectId) : 'projectRef' in state ? String(state.projectRef) : 'created'}</code>
              </article>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={() => void onRegenerateEnv()} disabled={regeneratingEnv}>
            {regeneratingEnv ? t('credentials.regenerating') : t('credentials.regenerateEnv')}
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
