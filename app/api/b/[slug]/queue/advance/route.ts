import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { advanceQueue } from '@/lib/api/handlers.mjs';

export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return advanceQueue(request, await apiCtx(request, slug));
}
