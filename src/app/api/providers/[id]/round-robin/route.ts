import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { z } from "zod";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

const roundRobinSchema = z.object({
  enabled: z.boolean(),
  stickyCount: z.number().int().min(1).max(1000),
});

type RoundRobinConfig = z.infer<typeof roundRobinSchema>;

// GET /api/providers/[id]/round-robin — read per-provider round-robin config
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;
    const settings = await getSettings();
    const overrides = (settings.providerRoundRobinOverrides || {}) as Record<
      string,
      RoundRobinConfig
    >;
    const config = overrides[provider];
    return NextResponse.json({
      enabled: config?.enabled ?? false,
      stickyCount: config?.stickyCount ?? 3,
    });
  } catch (err) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

// PUT /api/providers/[id]/round-robin — update per-provider round-robin config
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            message: "Invalid request",
            details: [{ field: "body", message: "Invalid JSON body" }],
          },
        },
        { status: 400 }
      );
    }
    const validation = validateBody(roundRobinSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const body = validation.data;

    // Read current overrides, merge, write back
    const settings = await getSettings();
    const currentOverrides = (settings.providerRoundRobinOverrides || {}) as Record<
      string,
      RoundRobinConfig
    >;

    const updated = {
      ...currentOverrides,
      [provider]: { enabled: body.enabled, stickyCount: body.stickyCount },
    };

    await updateSettings({ providerRoundRobinOverrides: updated } as Record<string, unknown>);

    return NextResponse.json({
      enabled: body.enabled,
      stickyCount: body.stickyCount,
    });
  } catch (err) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

// DELETE /api/providers/[id]/round-robin — remove per-provider round-robin config
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: provider } = await params;
    const settings = await getSettings();
    const currentOverrides = (settings.providerRoundRobinOverrides || {}) as Record<
      string,
      RoundRobinConfig
    >;

    if (!currentOverrides[provider]) {
      return NextResponse.json({ deleted: false });
    }

    delete currentOverrides[provider];

    await updateSettings({ providerRoundRobinOverrides: currentOverrides } as Record<
      string,
      unknown
    >);

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
