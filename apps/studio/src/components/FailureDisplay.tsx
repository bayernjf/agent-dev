import { useState } from 'react';
import { classifyFailure, categoryLabel, severityLabel, type FailureClassification } from '@agent-dev/agent-runtime';

type FailureDisplayProps = {
  error: string;
};

export function FailureDisplay({ error }: FailureDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const classification: FailureClassification = classifyFailure(error);

  const categoryColor: Record<string, string> = {
    environment: '#e67e22',
    configuration: '#f39c12',
    platform: '#3498db',
    product: '#9b59b6',
    unknown: '#95a5a6',
  };

  return (
    <div className="failure-display" style={{ borderLeft: `4px solid ${categoryColor[classification.category]}` }}>
      <div className="failure-header">
        <span className="failure-category" style={{ color: categoryColor[classification.category] }}>
          {categoryLabel(classification.category)}
        </span>
        <span className="failure-severity">{severityLabel(classification.severity)}</span>
        {classification.autoRetryable && <span className="failure-retryable">Auto-retryable</span>}
      </div>
      <p className="failure-title">{classification.title}</p>
      <p className="failure-explanation">{classification.explanation}</p>

      {classification.remediation.length > 0 && (
        <div className="failure-remediation">
          <button
            type="button"
            className="failure-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide' : 'Show'} remediation steps ({classification.remediation.length})
          </button>
          {expanded && (
            <ol>
              {classification.remediation.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <details className="failure-raw">
        <summary>Raw error</summary>
        <pre>{error}</pre>
      </details>
    </div>
  );
}
