import type { AgentCapabilityProbe } from '../types';

export type NonInteractiveVerdict = 'listed' | 'absent' | 'inconclusive';

type ProbeFacts = Pick<AgentCapabilityProbe, 'nonInteractive' | 'nonInteractiveFlags' | 'helpAvailable'>;

// The capability probe reads a CLI's help output and never runs it, so `nonInteractive: false` is not
// one fact but two, and the row used to print the same `non-interactive: unknown` for both - which
// reported "nobody looked" about a switch that had been looked for and not found, and reported
// "unknown" about an Agent whose help output was never going to answer in the first place:
//
// - the help output answered, and the switches our Adapter passes are not in it;
// - the help output never answered (nothing printed, or it timed out), or there was nothing to look
//   for because this Agent's non-interactive path is not a switch at all - OpenCode 2.0 is driven
//   through a local API its help text does not describe.
//
// Only the first is a finding about the Agent. The daemon cannot tell them apart either, so the
// distinction is derived here from the two facts it does send.
export function nonInteractiveVerdict(probe: ProbeFacts): NonInteractiveVerdict {
  if (probe.nonInteractive) return 'listed';
  if (probe.nonInteractiveFlags.length === 0 || !probe.helpAvailable) return 'inconclusive';
  return 'absent';
}
