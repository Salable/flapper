import { apiCtx } from '@/lib/api/next-ctx';
import { accountTier } from '@/lib/api/handlers.mjs';

export async function POST(request: Request) {
  return accountTier(request, await apiCtx(request));
}
