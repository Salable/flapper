import { apiCtx } from '@/lib/api/next-ctx';
import { createBoard, listBoards } from '@/lib/api/handlers.mjs';

export async function POST(request: Request) {
  return createBoard(request, await apiCtx(request));
}

export async function GET(request: Request) {
  return listBoards(request, await apiCtx(request));
}
