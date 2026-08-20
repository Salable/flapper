import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { boardIndex, boardPatch, boardDelete } from '@/lib/api/handlers.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return boardIndex(request, await apiCtx(request, slug));
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return boardPatch(request, await apiCtx(request, slug));
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return boardDelete(request, await apiCtx(request, slug));
}
