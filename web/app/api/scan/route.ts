import { NextResponse } from 'next/server';
import { runProofscan, type RunRequest } from '@/lib/proofscan-runner';

// The scan runs the real pipeline: sandbox provisioning does an npm install and
// boots a server, so this needs the Node runtime and a generous budget.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: RunRequest;
  try {
    body = (await request.json()) as RunRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (body.mode !== 'sample' && body.mode !== 'byo') {
    return NextResponse.json({ error: 'mode must be "sample" or "byo".' }, { status: 400 });
  }
  if (!body.layers?.staticLayer && !body.layers?.aiReasoning && !body.layers?.dynamic) {
    return NextResponse.json({ error: 'Select at least one layer to run.' }, { status: 400 });
  }

  try {
    const result = await runProofscan(body);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[scan] failed:', err);
    const message = err instanceof Error ? err.message : 'Scan failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
