import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isApiKeyRevealEnabled, maskStoredApiKey } from "@/lib/apiKeyExposure";
import { addKeysToPool, removeKeyFromPool, getPoolKeysPaged, getPoolCount } from "@/models";
import { addPoolKeysSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { isManagedProviderConnectionId } from "@/lib/providers/catalog";
import {
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import type { PoolKeyInput } from "@/lib/db/keyPool";

function canHostKeyPool(provider: string): boolean {
  return (
    isManagedProviderConnectionId(provider) ||
    isOpenAICompatibleProvider(provider) ||
    isAnthropicCompatibleProvider(provider)
  );
}

// GET /api/providers/[id]/pool — list a provider's reserve key pool (paged)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "50")));
    const offset = (page - 1) * limit;

    const [keys, count] = await Promise.all([
      getPoolKeysPaged(provider, limit, offset),
      getPoolCount(provider),
    ]);

    const reveal = isApiKeyRevealEnabled();
    const safeKeys = keys.map((k) => ({
      id: k.id,
      name: k.name,
      key: reveal ? k.key : maskStoredApiKey(k.key),
      createdAt: k.createdAt,
    }));

    return NextResponse.json({ keys: safeKeys, count, page, limit, reveal });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/providers/[id]/pool — add keys (either {keys:[...]} or {lines:"name|key\n..."})
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;

    // Reject unknown provider ids early — only managed/compatible providers can
    // host a connectable pool.
    if (!canHostKeyPool(provider)) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    const body = await request.json();
    const validation = validateBody(addPoolKeysSchema, body);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { keys: directKeys, lines } = validation.data;
    const parsedFromLines: PoolKeyInput[] = [];
    if (typeof lines === "string" && lines.length > 0) {
      for (const rawLine of lines.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const sep = line.indexOf("|");
        if (sep === -1) {
          parsedFromLines.push({ key: line });
        } else {
          const name = line.slice(0, sep).trim();
          const key = line.slice(sep + 1).trim();
          if (key) parsedFromLines.push({ name: name || null, key });
        }
      }
    }

    const allKeys: PoolKeyInput[] = [
      ...(Array.isArray(directKeys) ? (directKeys as PoolKeyInput[]) : []),
      ...parsedFromLines,
    ];
    if (allKeys.length === 0) {
      return NextResponse.json({ error: "No keys provided" }, { status: 400 });
    }

    const result = await addKeysToPool(provider, allKeys);
    const count = await getPoolCount(provider);
    return NextResponse.json({ ...result, count });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/providers/[id]/pool?keyId=... — remove a single pool key
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;
    const url = new URL(request.url);
    const keyId = url.searchParams.get("keyId");
    if (!keyId) {
      return NextResponse.json({ error: "keyId is required" }, { status: 400 });
    }

    const removed = await removeKeyFromPool(keyId);
    if (!removed) {
      return NextResponse.json({ error: "Key not found in pool", provider }, { status: 404 });
    }
    const count = await getPoolCount(provider);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
