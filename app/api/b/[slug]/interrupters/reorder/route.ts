import { apiCtx } from '@/lib/api/next-ctx';
import { reorderInterrupters } from '@/lib/api/handlers.mjs';

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return reorderInterrupters(request, await apiCtx(request, slug));
}
