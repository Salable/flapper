import { apiCtx } from '@/lib/api/next-ctx';
import { createBoard } from '@/lib/api/handlers.mjs';

export async function POST(request: Request) {
  return createBoard(request, await apiCtx(request));
}
