import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { rotateKey, getBoardKey } from '@/lib/api/handlers.mjs';

export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return rotateKey(request, await apiCtx(request, slug));
}

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return getBoardKey(request, await apiCtx(request, slug));
}
