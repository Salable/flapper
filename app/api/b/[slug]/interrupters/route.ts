import { apiCtx } from '@/lib/api/next-ctx';
import { listInterrupters, saveInterrupter } from '@/lib/api/handlers.mjs';

type Ctx = { params: Promise<{ slug: string }> };

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return listInterrupters(request, await apiCtx(request, slug));
}

export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return saveInterrupter(request, await apiCtx(request, slug));
}
