import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { getTheme } from '@/lib/api/handlers.mjs';

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return getTheme(request, await apiCtx(request, slug));
}
