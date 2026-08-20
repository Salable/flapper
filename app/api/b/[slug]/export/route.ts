import { apiCtx } from '@/lib/api/next-ctx';
import { exportQueue } from '@/lib/api/handlers.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return exportQueue(request, await apiCtx(request, slug));
}
