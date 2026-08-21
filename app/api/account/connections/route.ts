import { apiCtx } from '@/lib/api/next-ctx';
import { listConnections } from '@/lib/api/connections.mjs';

export async function GET(request: Request) {
  return listConnections(request, await apiCtx(request));
}
