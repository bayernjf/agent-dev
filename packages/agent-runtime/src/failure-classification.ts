/**
 * Failure classification and human-readable remediation suggestions.
 *
 * Based on 29 real-world defects from three production projects.
 * Categories: environment, configuration, platform, product.
 *
 * Goal: external users (not the author) can understand what went wrong
 * and how to fix it, without reading raw stack traces or daemon logs.
 */

export type FailureCategory = 'environment' | 'configuration' | 'platform' | 'product' | 'unknown';

export type FailureSeverity = 'blocking' | 'recoverable' | 'warning';

export type FailureClassification = {
  category: FailureCategory;
  severity: FailureSeverity;
  /** Short, human-readable title (what went wrong). */
  title: string;
  /** Detailed explanation suitable for non-author users. */
  explanation: string;
  /** Step-by-step remediation actions. */
  remediation: string[];
  /** Whether the system can auto-retry (true) or requires human action (false). */
  autoRetryable: boolean;
  /** Related defect IDs from real-world-lessons.md (for debugging). */
  relatedDefects?: number[];
};

// ---------------------------------------------------------------------------
// Pattern matchers: map error messages / contexts to classifications.
// Each entry: pattern (regex) + classification factory.
// ---------------------------------------------------------------------------

type FailurePattern = {
  pattern: RegExp;
  category: FailureCategory;
  severity: FailureSeverity;
  title: string;
  explanation: string;
  remediation: string[];
  autoRetryable: boolean;
  relatedDefects?: number[];
};

const FAILURE_PATTERNS: FailurePattern[] = [
  // --- Environment: Node version ---
  {
    pattern: /(engine|node).*(version|>=?\s*22)|requires node.*>=?\s*22|npm ci.*fail/i,
    category: 'environment',
    severity: 'blocking',
    title: 'Node.js version too old',
    explanation: 'Agent-Dev requires Node.js 22 or newer. Your current version is older, which causes dependency installation failures.',
    remediation: [
      'Install Node.js 22 or newer (recommended: use fnm or nvm)',
      'Run `node --version` to confirm the active version',
      'If using fnm: `fnm install 22 && fnm use 22`',
      'Restart the Agent-Dev daemon after switching Node versions',
    ],
    autoRetryable: false,
    relatedDefects: [15],
  },
  // --- Environment: Agent not found ---
  {
    pattern: /(command not found|not found on local PATH|not installed|not detected).*(codex|claude|opencode|agent)/i,
    category: 'environment',
    severity: 'blocking',
    title: 'Coding agent CLI not found',
    explanation: 'The selected coding agent (Codex, Claude Code, or OpenCode) is not installed or not on your system PATH. Agent-Dev needs it to execute feature tasks.',
    remediation: [
      'Install the coding agent you want to use',
      'Codex: `npm install -g @openai/codex`',
      'Claude Code: `npm install -g @anthropic-ai/claude-code`',
      'OpenCode: follow installation guide at opencode.ai',
      'Run `which codex` (or claude / opencode) to confirm it is on PATH',
      'Restart the Agent-Dev daemon after installation',
    ],
    autoRetryable: false,
    relatedDefects: [16, 29],
  },
  // --- Environment: Network / proxy ---
  {
    pattern: /(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|proxy|timeout|fetch failed|unable to connect)/i,
    category: 'environment',
    severity: 'recoverable',
    title: 'Network connection failed',
    explanation: 'A network request failed. This could be due to a proxy configuration issue, DNS failure, or temporary network outage.',
    remediation: [
      'Check your internet connection',
      'If behind a corporate proxy, ensure HTTPS_PROXY / HTTP_PROXY environment variables are set',
      'Try the operation again — transient network failures often resolve on retry',
      'If the issue persists, check firewall settings',
    ],
    autoRetryable: true,
  },
  // --- Configuration: Git / repository ---
  {
    pattern: /(not a git repository|git.*(init|clone).*fail|repository.*not found|remote.*not found|origin.*not)/i,
    category: 'configuration',
    severity: 'blocking',
    title: 'Git repository issue',
    explanation: 'The project workspace is not a valid Git repository, or the remote origin is misconfigured. Agent-Dev requires a Git repository to track changes and create pull requests.',
    remediation: [
      'Ensure the project workspace contains a `.git` directory',
      'Run `git remote -v` to verify the origin is configured correctly',
      'If importing an existing repository, ensure it was cloned with full history',
      'Re-run the Apply step to re-initialize the repository if needed',
    ],
    autoRetryable: false,
    relatedDefects: [3, 4],
  },
  // --- Configuration: Secret / .env leak ---
  {
    pattern: /(\.env|secret|credential|api[_-]?key).*(commit|leak|blocked|found)|sensitive file/i,
    category: 'configuration',
    severity: 'blocking',
    title: 'Secret file detected in changes',
    explanation: 'Agent-Dev blocked a commit because it detected a file containing secrets (like .env) or credentials. This is a safety guard to prevent accidental secret leakage.',
    remediation: [
      'Check the workspace for files like `.env`, `.vercel/`, `.wrangler/` that should not be committed',
      'Ensure `.gitignore` includes `.env`, `.vercel/`, `.wrangler/`, `.agent-dev/`',
      'Move secrets to environment variables or a secret manager instead of files',
      'After cleaning up, retry the operation',
    ],
    autoRetryable: false,
    relatedDefects: [2],
  },
  // --- Configuration: Quality gate failure ---
  {
    pattern: /(quality|lint|typecheck|test|build).*(fail|error|missing script)|npm error Missing script/i,
    category: 'configuration',
    severity: 'recoverable',
    title: 'Quality gate failed',
    explanation: 'The project quality check (lint, typecheck, test, or build) failed. This means the generated code has issues that need to be fixed before it can be accepted.',
    remediation: [
      'Read the quality gate output to see which check failed and why',
      'Fix the issues in the source code',
      'Run `npm run quality` locally to verify all checks pass',
      'If a script is missing (e.g. "typecheck"), ensure package.json defines all required quality scripts',
      'After fixing, retry the operation',
    ],
    autoRetryable: false,
    relatedDefects: [8, 18, 21],
  },
  // --- Configuration: CORS ---
  {
    pattern: /(cors|cross-origin|access-control-allow-origin)/i,
    category: 'configuration',
    severity: 'recoverable',
    title: 'CORS configuration issue',
    explanation: 'A Cross-Origin Resource Sharing (CORS) issue was detected. The frontend may not be able to communicate with the API due to misconfigured origin headers.',
    remediation: [
      'Check that the API server includes CORS headers matching the frontend origin',
      'Verify the ALLOWED_ORIGIN environment variable is set correctly',
      'For Vercel deployments, ensure the API route exports CORS middleware',
      'Clear browser cache and retry',
    ],
    autoRetryable: false,
    relatedDefects: [11, 14],
  },
  // --- Platform: PR creation ---
  {
    pattern: /(pull request|PR).*(fail|cannot|error|not created)|gh.*(repo|pr).*fail/i,
    category: 'platform',
    severity: 'recoverable',
    title: 'Pull request creation failed',
    explanation: 'Agent-Dev could not create a pull request. This is usually due to GitHub authentication issues, missing branches, or repository permission problems.',
    remediation: [
      'Ensure you are authenticated with GitHub: run `gh auth status`',
      'If not authenticated, run `gh auth login`',
      'Verify the repository has both `main` and `dev` branches',
      'Check that you have write access to the repository',
      'After fixing, retry the operation',
    ],
    autoRetryable: false,
    relatedDefects: [3, 5],
  },
  // --- Platform: Deployment ---
  {
    pattern: /(vercel|cloudflare|deploy|preview).*(fail|error|timeout)|deployment.*(fail|error)/i,
    category: 'platform',
    severity: 'recoverable',
    title: 'Deployment failed',
    explanation: 'The deployment to Vercel or Cloudflare Pages failed. This could be due to authentication issues, configuration errors, or platform outages.',
    remediation: [
      'Check your Vercel / Cloudflare authentication tokens',
      'Run `vercel whoami` to verify Vercel login',
      'Check the deployment logs for specific error messages',
      'Ensure the project configuration (vercel.json, wrangler.toml) is valid',
      'If it is a platform outage, wait and retry',
    ],
    autoRetryable: true,
    relatedDefects: [6, 13],
  },
  // --- Platform: Agent execution ---
  {
    pattern: /(codex|claude|opencode|agent).*(exit code|error|fail|crash|non-zero)/i,
    category: 'platform',
    severity: 'recoverable',
    title: 'Coding agent execution failed',
    explanation: 'The coding agent (Codex / Claude Code / OpenCode) exited with an error. This could be due to API rate limits, token issues, or the agent encountering an unrecoverable problem.',
    remediation: [
      'Check the agent output log for the specific error',
      'If rate limited, wait a few minutes and retry',
      'Verify your API key / authentication for the agent',
      'Check that the agent has enough context window for the task',
      'If the task is too large, try breaking it into smaller feature tasks',
    ],
    autoRetryable: true,
    relatedDefects: [7],
  },
  // --- Product: Approval missing ---
  {
    pattern: /(approve|approval|approver).*(required|missing|not found)|not approved/i,
    category: 'product',
    severity: 'blocking',
    title: 'Approval required',
    explanation: 'This step requires explicit human approval before it can proceed. Agent-Dev never auto-approves production changes or feature acceptance.',
    remediation: [
      'Look for the approval button in the Studio UI',
      'Enter your name as the approver (this is recorded for audit)',
      'Review the changes before approving',
      'If you do not see an approval button, ensure the previous step completed successfully',
    ],
    autoRetryable: false,
  },
  // --- Product: Task not ready ---
  {
    pattern: /(feature task|task).*(not found|not approved|draft|not ready)|no.*(task|feature).*exist/i,
    category: 'product',
    severity: 'blocking',
    title: 'Feature task not ready',
    explanation: 'No approved feature task exists for this project. You need to define and approve a feature task before the coding agent can execute it.',
    remediation: [
      'Go to the Iteration tab in Studio',
      'Define a feature task with a clear objective and acceptance criteria',
      'Approve the feature task (enter your name as approver)',
      'Once approved, the Runtime execution will become available',
    ],
    autoRetryable: false,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an error based on its message and optional context.
 * Returns the best matching classification, or a generic "unknown" classification.
 */
export function classifyFailure(
  errorMessage: string,
  context?: { step?: string; agentId?: string; projectState?: string },
): FailureClassification {
  const message = errorMessage.toLowerCase();

  for (const pattern of FAILURE_PATTERNS) {
    if (pattern.pattern.test(message)) {
      return {
        category: pattern.category,
        severity: pattern.severity,
        title: pattern.title,
        explanation: pattern.explanation,
        remediation: pattern.remediation,
        autoRetryable: pattern.autoRetryable,
        relatedDefects: pattern.relatedDefects,
      };
    }
  }

  // Context-based fallback classification
  if (context?.step) {
    const step = context.step.toLowerCase();
    if (step.includes('apply') || step.includes('provision')) {
      return genericPlatformFailure(errorMessage, 'Apply/provisioning step failed');
    }
    if (step.includes('release') || step.includes('deploy')) {
      return genericPlatformFailure(errorMessage, 'Release/deployment step failed');
    }
    if (step.includes('runtime') || step.includes('execute') || step.includes('implement')) {
      return genericPlatformFailure(errorMessage, 'Agent execution step failed');
    }
  }

  return {
    category: 'unknown',
    severity: 'blocking',
    title: 'An unexpected error occurred',
    explanation: `The system encountered an error that could not be automatically classified: ${errorMessage}`,
    remediation: [
      'Check the daemon logs for more details',
      'Try the operation again',
      'If the issue persists, report it with the error message and what you were doing',
    ],
    autoRetryable: false,
  };
}

function genericPlatformFailure(errorMessage: string, title: string): FailureClassification {
  return {
    category: 'platform',
    severity: 'recoverable',
    title,
    explanation: `A platform step failed with: ${errorMessage}`,
    remediation: [
      'Check the detailed error output for specific information',
      'Try the operation again — many platform failures are transient',
      'If it persists, verify your authentication tokens and network connection',
    ],
    autoRetryable: true,
  };
}

/**
 * Get a human-readable label for a failure category.
 */
export function categoryLabel(category: FailureCategory): string {
  const labels: Record<FailureCategory, string> = {
    environment: 'Environment issue',
    configuration: 'Configuration issue',
    platform: 'Platform issue',
    product: 'Process / approval',
    unknown: 'Unknown',
  };
  return labels[category];
}

/**
 * Get a human-readable label for severity.
 */
export function severityLabel(severity: FailureSeverity): string {
  const labels: Record<FailureSeverity, string> = {
    blocking: 'Blocking — requires action',
    recoverable: 'Recoverable — may resolve on retry',
    warning: 'Warning — non-blocking',
  };
  return labels[severity];
}
