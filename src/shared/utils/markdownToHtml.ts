import { marked } from "marked";

export function markdownToHtml(content: string, role?: string): string {
  if (!content || content.length === 0) return "";
  return marked.parse(content, { async: false }) as string;
}
