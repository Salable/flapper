import { apiCtx } from '@/lib/api/next-ctx';
import { fireInterrupter } from '@/lib/api/handlers.mjs';

type Ctx = { params: Promise<{ slug: string; name: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { slug, name } = await ctx.params;
  return fireInterrupter(request, { ...(await apiCtx(request, slug)), name });
}
