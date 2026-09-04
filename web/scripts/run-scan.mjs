/**
 * Standalone scan driver.
 *
 * Runs in its own plain Node ESM process — the same way the CLI runs the tool —
 * so proofscan is never touched by the web bundler and its child-process /
 * filesystem behaviour is exactly as shipped. The API route spawns this, writes
 * a RunRequest as JSON on stdin, and reads a RunResult as JSON on stdout.
 *
 * Target policy: live layers (AI-reasoning verification, dynamic fuzzer) only
 * ever run against an operator-owned sandbox booted from a bundled synthetic
 * fixture. An arbitrary URL is never contacted.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const { runScan, adHocTarget, provisionLocalSandbox } = await import('proofscan');

const HERE = dirname(fileURLToPath(import.meta.url));

function rulesDir() {
  return join(dirname(require.resolve('proofscan/package.json')), 'rules', 'semgrep');
}
function sandboxTargetsDir() {
  return process.env.SANDBOX_TARGETS_DIR ?? join(HERE, '..', 'sandbox-targets');
}

const TIMEOUT_MS = 240_000;

const BOOKMARKS_DYNAMIC = {
  auth: {
    register_path: '/auth/signup',
    login_path: '/auth/token',
    username_field: 'username',
    password_field: 'passphrase',
    token_field: 'accessToken',
  },
  resources: [
    {
      name: 'bookmarks',
      collection: '/v1/bookmarks',
      item: '/v1/bookmarks/:bookmarkId',
      methods: ['GET', 'PATCH', 'DELETE'],
      child: '/v1/bookmarks/:bookmarkId/tags',
      create_fields: ['url', 'label'],
    },
  ],
};

const SUPPORTS = {
  'second-app': { aiReasoning: true, dynamic: true },
  vulnerable: { aiReasoning: false, dynamic: false },
  clean: { aiReasoning: false, dynamic: false },
};

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const req = JSON.parse(await readStdin());
  const started = Date.now();
  const operatorNotes = [];
  let source = null;
  let dynamic = null;
  let targetLabel = '';
  let sourceDir = null;
  let tempDir = null;
  let bootable = false;

  try {
    if (req.mode === 'byo') {
      const code = (req.byoSource ?? '').trim();
      if (!code) throw new Error('No source was provided for the bring-your-own-source scan.');
      if (code.length > 200_000) throw new Error('Pasted source is too large (200 KB limit).');
      tempDir = mkdtempSync(join(tmpdir(), 'proofscan-byo-'));
      writeFileSync(join(tempDir, 'server.js'), code, 'utf8');
      if (req.byoInitDb && String(req.byoInitDb).trim()) {
        writeFileSync(join(tempDir, 'initDb.js'), req.byoInitDb, 'utf8');
      }
      sourceDir = tempDir;
      targetLabel = 'your pasted source';
      operatorNotes.push(
        'Bring-your-own-source runs the static and AI-reasoning layers only. Sandboxed verification needs a runnable target with a start script and the dynamic layer needs a manifest — neither exists for a pasted snippet, so any AI finding stays unverified-flagged here.',
      );
    } else {
      const sample = req.sample ?? 'second-app';
      sourceDir = join(sandboxTargetsDir(), sample);
      targetLabel =
        sample === 'second-app'
          ? 'Bookmarks API (full demo)'
          : sample === 'vulnerable'
            ? 'Vulnerable fixture (static)'
            : 'Clean control (negative)';
      bootable = SUPPORTS[sample]?.aiReasoning || SUPPORTS[sample]?.dynamic || false;
    }

    const sourceLayers = [];
    if (req.layers?.staticLayer) sourceLayers.push('static');
    if (req.layers?.aiReasoning) sourceLayers.push('ai-reasoning');

    if (sourceLayers.length > 0 && sourceDir) {
      source = await runScan({
        target: adHocTarget(sourceDir),
        layers: sourceLayers,
        rulesDir: rulesDir(),
        onlyScanners: [],
        timeoutMs: TIMEOUT_MS,
        kevCatalogPath: null,
        authorizedFlag: false,
        storeRoot: null,
        reasoner: 'heuristic',
        verify: Boolean(req.layers?.aiReasoning) && bootable,
      });
    }

    if (req.mode === 'sample' && req.sample === 'second-app' && req.layers?.dynamic) {
      operatorNotes.push('Booting the bookmarks fixture as a live sandbox on a private local port …');
      const prov = await provisionLocalSandbox(join(sandboxTargetsDir(), 'second-app'), TIMEOUT_MS);
      if (!prov.ok || !prov.sandbox) {
        operatorNotes.push(
          `The live sandbox could not be booted (${prov.detail ?? 'unknown'}). This is an environment limit, not a scan failure — the dynamic layer was skipped.`,
        );
      } else {
        try {
          const target = {
            id: 'demo-live',
            name: 'bookmarks-live',
            source_type: 'runtime_url',
            source_uri: '',
            runtime_base_url: prov.sandbox.baseUrl,
            authorized_by: 'proofscan-demo',
            authorized_at: new Date().toISOString(),
            authorization_basis:
              'operator-owned synthetic fixture, ephemeral sandbox provisioned and torn down by this request',
            dynamic: BOOKMARKS_DYNAMIC,
          };
          dynamic = await runScan({
            target,
            layers: ['dynamic-fuzzer'],
            rulesDir: '',
            onlyScanners: [],
            timeoutMs: 60_000,
            kevCatalogPath: null,
            authorizedFlag: true,
            storeRoot: null,
            reasoner: 'heuristic',
            verify: false,
          });
        } finally {
          await prov.sandbox.teardown();
          operatorNotes.push('Live sandbox torn down.');
        }
      }
    } else if (req.layers?.dynamic) {
      operatorNotes.push(
        'The dynamic layer only runs against the operator-owned bookmarks sandbox — it was not run for this target, by design (no arbitrary live targets).',
      );
    }

    process.stdout.write(
      JSON.stringify({ source, dynamic, operatorNotes, targetLabel, durationMs: Date.now() - started }),
    );
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err?.stack ?? err?.message ?? String(err) }));
  process.exit(1);
});
