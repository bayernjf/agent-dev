import { useI18n } from '../i18n/i18n';

/**
 * Resolve a domain prose field that the backend emits alongside a stable i18n key.
 *
 * The blueprint package keeps English prose as the contract (the MCP bridge feeds it to external
 * coding agents), and Studio adds a parallel key. `domainT` prefers the locale translation; when the
 * key is absent from both the current locale and the English fallback, `t()` returns the key itself,
 * in which case we fall back to the backend's English prose so the UI never shows a raw key.
 *
 * `key` may be omitted for fields that have not yet been keyed — then the English prose is rendered
 * unchanged, which keeps incremental migration safe.
 */
export function useDomainText() {
  const { t } = useI18n();
  return (text: string, key?: string, params?: Record<string, string | number>): string => {
    if (!key) return text;
    const translated = t(key as Parameters<typeof t>[0], params);
    return translated === key ? text : translated;
  };
}
