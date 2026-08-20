import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { patchConfig } from '@/lib/api/handlers.mjs';

export async function PATCH(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return patchConfig(request, await apiCtx(request, slug));
}
