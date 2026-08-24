import { apiCtx } from '@/lib/api/next-ctx';
import {
  getDesignHandler,
  updateDesignHandler,
  deleteDesignHandler,
} from '@/lib/api/handlers.mjs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return getDesignHandler(request, { ...(await apiCtx(request)), designId: id });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return updateDesignHandler(request, { ...(await apiCtx(request)), designId: id });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return deleteDesignHandler(request, { ...(await apiCtx(request)), designId: id });
}
