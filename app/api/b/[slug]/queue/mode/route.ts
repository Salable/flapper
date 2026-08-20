import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { queueMode } from '@/lib/api/handlers.mjs';

export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return queueMode(request, await apiCtx(request, slug));
}
