import { apiCtx } from "@/lib/api/next-ctx";
type Ctx = { params: Promise<{ slug: string }> };
import { postMessage } from '@/lib/api/handlers.mjs';

// Adding a queue item and posting a message are the same act; this route is
// the queue-flavoured spelling of POST /message.
export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return postMessage(request, await apiCtx(request, slug));
}
