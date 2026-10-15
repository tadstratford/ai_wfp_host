/**
 * Unified Vision API
 * Single entry point for all vision analysis operations
 */

import { settings } from "@backend/core/settings/settings";

export interface VisionRequest {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  provider?: "together" | "openai" | "anthropic";
}

export interface VisionResponse {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Single vision API function - handles all vision analysis requests
 */
export async function callVisionAPI(
  request: VisionRequest
): Promise<VisionResponse> {
  const provider = request.provider || "together";

  try {
    switch (provider) {
      case "together":
        return await callTogetherVision(request);

      case "openai":
        // Future: return await callOpenAIVision(request);
        throw new Error("OpenAI vision not yet implemented");

      case "anthropic":
        // Future: return await callAnthropicVision(request);
        throw new Error("Anthropic vision not yet implemented");

      default:
        throw new Error(`Unknown vision provider: ${provider}`);
    }
  } catch (error) {
    console.error(`[VisionAPI] Error calling ${provider}:`, error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unknown vision API error",
    };
  }
}

/**
 * Together AI vision implementation
 */
async function callTogetherVision(
  request: VisionRequest
): Promise<VisionResponse> {
  const config = settings.getLLMConfig();
  const apiKey = process.env[config.apiKeyEnv];

  if (!apiKey) {
    throw new Error(`${config.apiKeyEnv} is not set in environment variables`);
  }

  // Clean image data if needed
  let cleanImageData = request.imageBase64;
  if (cleanImageData.startsWith("data:")) {
    const commaIndex = cleanImageData.indexOf(",");
    if (commaIndex !== -1) {
      cleanImageData = cleanImageData.substring(commaIndex + 1);
    }
  }

  const payload = {
    model: config.visionModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: request.prompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${request.mimeType};base64,${cleanImageData}`,
            },
          },
        ],
      },
    ],
    max_tokens: request.maxTokens || 2000,
    temperature: request.temperature || 0.1,
  };

  console.log(
    `[VisionAPI] Calling Together AI vision model: ${config.visionModel}`
  );
  console.log(`[VisionAPI] Prompt length: ${request.prompt.length} chars`);
  console.log(
    `[VisionAPI] Image: ${request.mimeType}, ${cleanImageData.length} chars base64`
  );

  const response = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Together AI API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("No content in vision API response");
  }

  console.log(`[VisionAPI] Success - received ${content.length} chars`);

  return {
    success: true,
    content,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

/**
 * Parse vision response to JSON (with error handling)
 */
export function parseVisionResponse(content: string): any {
  try {
    // Clean common formatting issues
    let cleaned = content.trim();
    cleaned = cleaned.replace(/^```json\s*|\s*```$/gi, "");
    cleaned = cleaned.replace(/^```\s*|\s*```$/g, "");

    return JSON.parse(cleaned);
  } catch (error) {
    console.warn("[VisionAPI] Failed to parse response as JSON:", error);

    // Try to extract JSON from mixed content
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        // Give up
      }
    }

    // Return structured error response
    return {
      description: "Failed to parse structured data",
      rawContent: content,
    };
  }
}
