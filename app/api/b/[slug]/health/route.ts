import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { health } from '@/lib/api/handlers.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return health(request, await apiCtx(request, slug));
}
