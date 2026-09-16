import { apiCtx } from '@/lib/api/next-ctx';
import { requestLicence, listLicenceRequests } from '@/lib/api/handlers.mjs';

export async function POST(request: Request) {
  return requestLicence(request, await apiCtx(request));
}

export async function GET(request: Request) {
  return listLicenceRequests(request, await apiCtx(request));
}
