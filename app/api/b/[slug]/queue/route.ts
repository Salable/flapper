import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { getQueue, flushQueue } from '@/lib/api/handlers.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return getQueue(request, await apiCtx(request, slug));
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return flushQueue(request, await apiCtx(request, slug));
}
