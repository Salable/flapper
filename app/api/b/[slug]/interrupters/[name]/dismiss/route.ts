import { apiCtx } from '@/lib/api/next-ctx';
import { dismissInterrupter } from '@/lib/api/handlers.mjs';

type Ctx = { params: Promise<{ slug: string; name: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { slug, name } = await ctx.params;
  return dismissInterrupter(request, { ...(await apiCtx(request, slug)), name });
}
