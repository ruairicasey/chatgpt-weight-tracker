// Phase 1A deliberately registers no transport, tools, identities or credentials.
// The authenticated SDK adapter requires separate Phase 1B approval.
function unavailable() {
  return Response.json(
    { error: 'INTEGRATION_NOT_CONFIGURED' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
export const GET = unavailable;
export const POST = unavailable;
export const DELETE = unavailable;
