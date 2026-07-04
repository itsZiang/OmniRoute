import { z } from "zod";

/**
 * Validation schemas for the per-provider API key pool
 * (`/api/providers/[id]/pool/*`).
 *
 * Keys can arrive two ways:
 *   - via `addKeysToPool` direct objects (used by tests/auto-promotion), or;
 *   - via the bulk "paste lines" UI modal as a `lines` string of `name|key`
 *     or bare-key lines.
 *
 * `lines` is parsed server-side in the POST /pool handler — Zod only
 * validates the envelope: count limits + optional providerSpecificData shape.
 */

// POST /api/providers/[id]/pool — add keys to the pool.
// Accepts either `{ keys: [{ name?, key, providerSpecificData? }] }`
// or `{ lines: string }` (bulk paste).
export const addPoolKeysSchema = z
  .object({
    keys: z
      .array(
        z.object({
          name: z.string().max(200).optional().nullable(),
          key: z.string().min(1).max(10000),
          providerSpecificData: z.record(z.string(), z.unknown()).optional().nullable(),
        })
      )
      .max(1000)
      .optional(),
    lines: z.string().max(200_000).optional(),
  })
  .refine((val) => val.keys !== undefined || val.lines !== undefined, {
    message: "Either 'keys' or 'lines' must be provided",
  });

// POST /api/providers/[id]/pool/pull — promote pool keys to connections.
export const pullFromPoolSchema = z.object({
  count: z.number().int().min(1).max(100).default(30),
});

// POST /api/providers/[id]/pool/push — move apikey connections back to pool.
export const pushToPoolSchema = z.object({
  connectionIds: z.array(z.string().min(1).max(200)).min(1).max(1000),
});

// DELETE /api/providers/[id]/pool — keyId from query string.
export const deletePoolKeySchema = z.object({
  keyId: z.string().min(1).max(200),
});
