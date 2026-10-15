import { Session, ChatMessage } from "@backend/types";
import { runLLM } from "@backend/core/llm";

/**
 * Creates a concise message link description using LLM for user messages
 * 
 * @param messageMarkdown - The user's original message content
 * @param session - Current session for LLM context
 * @returns Promise<string> - Either original text (if ≤15 words) or LLM summary (≤40 words)
 */
export async function createLinkMessageWithLLM(
  messageMarkdown: string,
  session: Session
): Promise<string> {
  if (!messageMarkdown || typeof messageMarkdown !== 'string') {
    return "No content";
  }

  // Clean the markdown text for word counting
  const cleanText = messageMarkdown
    .replace(/[#*`_\[\]()]/g, '') // Remove markdown formatting
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Count words
  const wordCount = cleanText.split(' ').filter(word => word.length > 0).length;

  // If 15 words or less, return original
  if (wordCount <= 15) {
    return messageMarkdown;
  }

  try {
    // Create LLM prompt for summarization
    const prompt = `Summarize this user message in 40 words or less. Focus on the main intent or request. Be concise and clear.

User message: "${cleanText}"

Summary (40 words max):`;

    // Build messages array for clean LLM interface
    const messages: ChatMessage[] = [
      { role: "user", content: prompt }
    ];

    // Generate summary using LLM with specific options
    const result = await runLLM(messages, {
      temperature: 0.3, // Low temperature for consistent summaries
      maxTokens: 100,   // Enough for 40 words + buffer
      returnType: 'text' // Explicitly request text output
    });

    if (!result.success || !result.content || result.content.trim().length === 0) {
      console.warn('[LLM Message Link] LLM summarization failed, using fallback');
      // Fallback: truncate original to ~40 words
      const words = cleanText.split(' ');
      return words.slice(0, 40).join(' ') + (words.length > 40 ? '...' : '');
    }

    // Clean and return LLM summary
    const summary = result.content.trim();
    
    // Ensure it's not longer than original (safety check)
    if (summary.length >= cleanText.length) {
      const words = cleanText.split(' ');
      return words.slice(0, 40).join(' ') + (words.length > 40 ? '...' : '');
    }

    return summary;

  } catch (error) {
    console.error('[LLM Message Link] Error during LLM summarization:', error);
    
    // Fallback: truncate original to ~40 words
    const words = cleanText.split(' ');
    return words.slice(0, 40).join(' ') + (words.length > 40 ? '...' : '');
  }
}