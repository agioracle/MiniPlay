export interface ParsedError {
  type: 'build' | 'runtime';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  stack?: string;
}

/**
 * Parse build errors from phaser-wx build stderr/stdout.
 * Extracts file path, line number, and error message.
 */
export function parseBuildError(output: string): ParsedError[] {
  const errors: ParsedError[] = [];

  // Match common patterns:
  // Error: path/to/file.js:10:5 - error message
  // SyntaxError: /path/to/file.js: Unexpected token (10:5)
  // [vite/rollup] path/to/file.js (10:5): error message
  const patterns = [
    // Standard Node/Vite error: file:line:col
    /(?:Error|SyntaxError|TypeError|ReferenceError)[:\s]+(?:.*?[\\/])?(src[\\/][^\s:]+):(\d+):?(\d+)?[:\s-]*(.+)/gm,
    // Rollup-style: file (line:col): message
    /(?:.*?[\\/])?(src[\\/][^\s(]+)\s*\((\d+):(\d+)\)[:\s]*(.+)/gm,
    // Generic error lines
    /^(Error|SyntaxError|TypeError|ReferenceError|RollupError):\s*(.+)$/gm,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      if (match.length >= 5) {
        errors.push({
          type: 'build',
          file: match[1],
          line: parseInt(match[2], 10) || undefined,
          column: parseInt(match[3], 10) || undefined,
          message: match[4]?.trim() || match[0],
        });
      } else if (match.length >= 3) {
        errors.push({
          type: 'build',
          message: match[2]?.trim() || match[0],
        });
      }
    }
  }

  // If no structured errors found, create a generic one
  if (errors.length === 0 && output.trim()) {
    // Take the most relevant lines (include stack traces for context)
    const lines = output.split('\n').filter(l =>
      l.trim() &&
      !l.includes('node_modules') &&
      !l.startsWith('npm ')
    );
    const summary = lines.slice(0, 15).join('\n').trim();
    if (summary) {
      errors.push({
        type: 'build',
        message: summary,
      });
    }
  }

  // For structured errors, attach nearby stack trace lines
  if (errors.length > 0) {
    const outputLines = output.split('\n');
    for (const err of errors) {
      if (err.stack) continue; // already has stack
      // Find the error message in the output and grab following stack lines
      const msgIdx = outputLines.findIndex(l => l.includes(err.message.slice(0, 50)));
      if (msgIdx >= 0) {
        const stackLines: string[] = [];
        for (let i = msgIdx + 1; i < outputLines.length && i < msgIdx + 15; i++) {
          const line = outputLines[i];
          if (line.match(/^\s+at\s/) || line.match(/^\s+→/) || line.match(/^\s+\d+\s*\|/)) {
            stackLines.push(line);
          } else if (stackLines.length > 0) {
            break; // End of stack trace
          }
        }
        if (stackLines.length > 0) {
          err.stack = stackLines.join('\n');
        }
      }
    }
  }

  return errors;
}

/**
 * Parse a runtime error received via postMessage from the preview iframe.
 */
export function parseRuntimeError(data: {
  message?: string;
  source?: string;
  line?: number;
  stack?: string;
}): ParsedError {
  return {
    type: 'runtime',
    message: data.message || 'Unknown runtime error',
    file: data.source,
    line: data.line,
    stack: data.stack,
  };
}
