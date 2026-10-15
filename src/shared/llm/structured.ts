/**
 * Structured LLM output — schema-validated JSON without string scraping.
 *
 * Rather than asking the model to "return only JSON" and then hunting for the
 * first `{` in free text, this helper forces a single tool call whose
 * `input_schema` is derived from a Zod schema (`z.toJSONSchema`). The provider
 * returns the value as structured tool arguments, which `callProvider` already
 * privacy-unmasks, and we validate with `safeParse`.
 *
 * Fail-closed: if the model does not honor the forced tool (some OpenRouter /
 * DeepSeek models ignore `tool_choice`), or the result does not match the
 * schema, this returns `null` — never a guessed value and never raw text.
 */

import { z } from "zod";
import { callProvider } from "./providers";

export interface StructuredCallOptions<T> {
  databaseId: string;
  /** Zod schema describing the expected output shape. */
  schema: z.ZodType<T>;
  /** Valid tool identifier (`^[a-zA-Z0-9_-]{1,64}$`) — e.g. "emit_plan". */
  toolName: string;
  /** Short description of the tool (what it emits). */
  toolDescription: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  callOpts?: {
    userId?: string;
    mode?: string;
    phase: string;
  };
}

/**
 * Call the LLM and require it to emit a single structured value matching `schema`.
 *
 * @returns The validated value, or `null` when the model failed to produce
 *          a schema-conforming result. Callers must handle `null` (fail closed).
 */
export async function callStructured<T>(
  opts: StructuredCallOptions<T>,
): Promise<T | null> {
  const inputSchema = z.toJSONSchema(opts.schema) as Record<string, unknown>;

  const response = await callProvider(
    opts.databaseId,
    {
      system: opts.system,
      messages: [{ role: "user", content: opts.userMessage }],
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: inputSchema,
        },
      ],
      toolChoice: { name: opts.toolName },
      maxTokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0,
    },
    opts.callOpts,
  );

  const args = response.toolCall?.args;
  if (!args || typeof args !== "object") return null;

  const parsed = opts.schema.safeParse(args);
  return parsed.success ? parsed.data : null;
}
