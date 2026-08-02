# Security Policy

Agent-Dev is an early-stage project that handles delivery metadata, provider connections, environment contracts, and local agent execution. Do not use the current repository with production credentials or production infrastructure.

## Reporting A Vulnerability

Use GitHub's private vulnerability reporting flow under the repository's **Security** tab. Do not include credentials, tokens, private repository contents, or exploitable details in a public issue.

Reports should include:

- the affected document, Spike, module, or workflow;
- the expected and observed security boundary;
- minimal reproduction steps using synthetic credentials;
- potential impact and any known mitigation.

## Current Scope

The project currently validates local runtime, workflow recovery, Secret isolation, and provider orchestration contracts. Phase 0 Spikes are not production security guarantees. Verified and unverified boundaries are tracked in [`docs/spikes/README.md`](docs/spikes/README.md).
