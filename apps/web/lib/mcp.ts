import 'server-only';
import { createMcpGateway } from '@weight-tracker/mcp/server';

// No environment reads or issuer requests at import/build time.
const gateway = createMcpGateway(() => process.env);

export async function mcpRequest(request: Request): Promise<Response> {
  return gateway.fetch(request);
}

export function mcpMetadata(): Response {
  return gateway.metadata();
}
