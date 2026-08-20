import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { flushQueue } from '@/lib/api/handlers.mjs';

export async function DELETE(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return flushQueue(request, await apiCtx(request, slug));
}
