import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { eventsStream } from '@/lib/api/handlers.mjs';

export const dynamic = 'force-dynamic';
// The stream ends itself just before this window closes; EventSource reconnects
// with Last-Event-ID, so a shorter plan-imposed cap only shortens the window.
export const maxDuration = 300;

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return eventsStream(request, await apiCtx(request, slug));
}
