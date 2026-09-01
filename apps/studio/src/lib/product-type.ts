import type { BlueprintAnswers } from '@agent-dev/blueprint';
import type { KeyPath } from '../i18n/i18n';

// Product type decides which providers, resources and shells a delivery plan contains, so every
// place that shows one must use this table instead of printing the stored value: `api-tool` is a
// machine identifier, not something a user reads.
export const PRODUCT_TYPE_LABEL_KEYS = [
  ['web-app', 'blueprint.productTypeWebApp'],
  ['landing-page', 'blueprint.productTypeLandingPage'],
  ['browser-extension', 'blueprint.productTypeBrowserExtension'],
  ['desktop', 'blueprint.productTypeDesktop'],
  ['mobile', 'blueprint.productTypeMobile'],
  ['api-tool', 'blueprint.productTypeApiTool'],
] as const satisfies readonly [BlueprintAnswers['productType'], KeyPath][];

// Stored blueprints can outlive this build, so an unrecognised value stays visible as itself rather
// than disappearing or throwing on a key that no locale defines.
export function productTypeLabelKey(productType: string): KeyPath | undefined {
  const entry = PRODUCT_TYPE_LABEL_KEYS.find(([value]) => value === productType);
  return entry ? entry[1] : undefined;
}
