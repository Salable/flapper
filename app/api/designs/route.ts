import { apiCtx } from '@/lib/api/next-ctx';
import { listDesignsHandler, createDesignHandler } from '@/lib/api/handlers.mjs';

export async function GET(request: Request) {
  return listDesignsHandler(request, await apiCtx(request));
}

export async function POST(request: Request) {
  return createDesignHandler(request, await apiCtx(request));
}
