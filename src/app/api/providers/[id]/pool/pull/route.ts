import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  getProviderConnections,
  pullKeysFromPool,
  createPoolConnections,
  getPoolCount,
} from "@/models";
import { pullFromPoolSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

type JsonRecord = Record<string, unknown>;

// POST /api/providers/[id]/pool/pull — promote up to `count` pool keys into
// provider_connections rows (auth_type="apikey", inheriting baseUrl so
// compatible nodes keep routing correctly).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;
    const body = await request.json();
    const validation = validateBody(pullFromPoolSchema, body);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const count = validation.data.count;

    const existing = (await getProviderConnections({ provider, isActive: true })) as JsonRecord[];
    const existingKeys = existing
      .map((c) => (typeof c.apiKey === "string" ? c.apiKey : null))
      .filter((k): k is string => Boolean(k));

    const pulled = await pullKeysFromPool(provider, count, existingKeys);
    if (pulled.length === 0) {
      return NextResponse.json({ created: 0, remaining: await poolRemaining(provider) });
    }

    // Inherit baseUrl (etc.) so OpenAI/Anthropic-compatible nodes keep routing
    // to the same upstream as existing active connections.
    const inheritPsd =
      (existing.find((c) => {
        const psd = c.providerSpecificData as JsonRecord | undefined;
        return psd && typeof psd.baseUrl === "string" && psd.baseUrl.length > 0;
      })?.providerSpecificData as JsonRecord | undefined) || null;

    const created = await createPoolConnections(provider, pulled, existingKeys, inheritPsd);
    return NextResponse.json({
      created,
      pulled: pulled.length,
      remaining: await poolRemaining(provider),
    });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function poolRemaining(provider: string): Promise<number> {
  return getPoolCount(provider);
}
