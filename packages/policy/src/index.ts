export {
  runConnectorPreflight,
  runLocalCommand,
  type CommandResult,
  type CommandRunner,
  type ConnectorId,
  type ConnectorPreflight,
  type ConnectorPreflightReport,
  type ConnectorStatus,
} from './connectors.js';

export type AutomationMode = 'auto' | 'ask' | 'forbid';
export type ActionRisk = 'low' | 'medium' | 'high' | 'production' | 'secret';

export type PolicyDecision = {
  mode: AutomationMode;
  reason: string;
};

export function decideAutomation(risk: ActionRisk): PolicyDecision {
  if (risk === 'production' || risk === 'secret') {
    return { mode: 'ask', reason: 'Production and secret changes require a human decision.' };
  }
  if (risk === 'high') {
    return { mode: 'ask', reason: 'High-risk changes require a human decision.' };
  }
  return { mode: 'auto', reason: 'Low-risk local work can proceed automatically.' };
}
