import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { moveConnectionsToPool, getPoolCount } from "@/models";
import { pushToPoolSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

// POST /api/providers/[id]/pool/push — move apikey-type connections back into
// the pool. Reads the decrypted apiKey (only apikey connections recover a
// plaintext key; oauth/cookie skipped), inserts it as a pool row, then deletes
// the connection. Returns { moved, skipped, remaining }.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;
    const body = await request.json();
    const validation = validateBody(pushToPoolSchema, body);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { connectionIds } = validation.data;

    const result = await moveConnectionsToPool(provider, connectionIds);
    const remaining = await getPoolCount(provider);
    return NextResponse.json({ ...result, remaining });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
