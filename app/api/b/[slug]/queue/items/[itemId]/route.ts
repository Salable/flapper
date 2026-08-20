import { apiCtx } from '@/lib/api/next-ctx';
import { patchQueueItem, deleteQueueItem } from '@/lib/api/handlers.mjs';

type Ctx = { params: Promise<{ slug: string; itemId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { slug, itemId } = await ctx.params;
  return patchQueueItem(request, { ...(await apiCtx(request, slug)), itemId });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { slug, itemId } = await ctx.params;
  return deleteQueueItem(request, { ...(await apiCtx(request, slug)), itemId });
}
