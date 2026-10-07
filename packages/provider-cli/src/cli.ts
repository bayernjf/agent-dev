import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
};

export type CliOptions = {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  /**
   * Pass through to execFile's shell option. npm-installed CLIs resolve to `.cmd`/`.bat`
   * shims on Windows and EINVAL without a shell (audit §6.4, npm/npx same class).
   */
  shell?: boolean | 'win32';
  /**
   * Bytes written to the child's stdin before it is closed. Needed for CLIs whose confirmation
   * prompt cannot be disabled by flags (Vercel CLI 56 'project rm' asks 'Are you sure? (y/N)'
   * even with --non-interactive).
   */
  input?: string;
};

export type CommandRunner = (command: string, args: string[], options?: CliOptions) => Promise<CliResult>;

export const defaultRunner: CommandRunner = async (command, args, options) => {
  if (options?.input !== undefined) return runWithStdin(command, args, { ...options, input: options.input });
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      shell: options?.shell,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0, success: true };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? '').trim(),
      exitCode: err.code ?? 1,
      success: false,
    };
  }
};

export async function runCliJson<T>(runner: CommandRunner, command: string, args: string[], options?: CliOptions): Promise<T | null> {
  const result = await runner(command, args, options);
  if (!result.success) return null;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}


// execFile never touches stdin, so interactive confirmations would wait forever. This spawn-based
// path writes the caller-provided bytes and closes stdin, keeping the same CliResult shape.
function runWithStdin(command: string, args: string[], options: CliOptions & { input: string }): Promise<CliResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: options.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 1, success: false });
    }, options.timeout ?? 120_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: String(error).trim(), exitCode: 1, success: false });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1, success: code === 0 });
    });
    child.stdin.write(options.input);
    child.stdin.end();
  });
}
