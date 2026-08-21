import { apiCtx } from '@/lib/api/next-ctx';
import { disconnect } from '@/lib/api/connections.mjs';
type Ctx = { params: Promise<{ clientId: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const { clientId } = await ctx.params;
  return disconnect(request, { ...(await apiCtx(request)), clientId: decodeURIComponent(clientId) });
}
