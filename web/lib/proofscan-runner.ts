/**
 * Server-only bridge to the real proofscan tool.
 *
 * It does NOT reimplement or import the tool into the Next bundle. It spawns a
 * plain Node ESM process (scripts/run-scan.mjs) that imports proofscan natively
 * and runs the exact shipped pipeline, then relays that process's JSON result.
 * Running the scan out-of-process keeps the tool's child-process and filesystem
 * behaviour identical to the CLI and isolates the (sandbox-spawning) scan from
 * the web server.
 */
import 'server-only';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export type SampleTarget = 'second-app' | 'vulnerable' | 'clean';

export interface RunRequest {
  mode: 'sample' | 'byo';
  sample?: SampleTarget;
  byoSource?: string;
  byoInitDb?: string;
  layers: { staticLayer: boolean; aiReasoning: boolean; dynamic: boolean };
}

export interface RunResult {
  source: unknown | null;
  dynamic: unknown | null;
  operatorNotes: string[];
  targetLabel: string;
  durationMs: number;
}

function scriptPath(): string {
  return process.env.SCAN_SCRIPT ?? join(process.cwd(), 'scripts', 'run-scan.mjs');
}

const HARD_TIMEOUT_MS = 290_000;

export async function runProofscan(req: RunRequest): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath()], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Scan timed out.'));
    }, HARD_TIMEOUT_MS);

    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', (e) => {
      clearTimeout(killer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(killer);
      let parsed: (RunResult & { error?: string }) | null = null;
      try {
        parsed = JSON.parse(out);
      } catch {
        reject(new Error(`Scan process produced no valid result.${err ? ` (${err.slice(0, 400)})` : ''}`));
        return;
      }
      if (parsed && parsed.error) {
        reject(new Error(parsed.error.split('\n')[0]));
        return;
      }
      resolve(parsed as RunResult);
    });

    child.stdin.write(JSON.stringify(req));
    child.stdin.end();
  });
}
