import { apiCtx } from '@/lib/api/next-ctx';
import { deleteInterrupter } from '@/lib/api/handlers.mjs';

type Ctx = { params: Promise<{ slug: string; name: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const { slug, name } = await ctx.params;
  return deleteInterrupter(request, { ...(await apiCtx(request, slug)), name });
}
