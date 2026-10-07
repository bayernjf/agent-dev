// The canonical implementation lives in @agent-dev/provider-cli so the apply-stage registry can
// name projects identically to preview/release. Re-exported here to keep the composer API stable.
export { previewProjectNames, productionProjectNames, productionWebOrigin, type PreviewProjectNames } from '@agent-dev/provider-cli';
