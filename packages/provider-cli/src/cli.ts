import { execFile } from 'node:child_process';
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
};

export type CommandRunner = (command: string, args: string[], options?: CliOptions) => Promise<CliResult>;

export const defaultRunner: CommandRunner = async (command, args, options) => {
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
