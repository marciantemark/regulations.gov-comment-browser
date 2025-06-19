/**
 * Common utility for parsing JSON from AI responses that may contain markdown code blocks
 */
export function parseJsonResponse(text: string): any {
  // Try to find JSON in code blocks first (```json or just ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const jsonContent = codeBlockMatch[1].trim();
    try {
      return JSON.parse(jsonContent);
    } catch (e) {
      console.error("Failed to parse JSON from code block:", jsonContent);
      throw new Error(`Invalid JSON in code block: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  
  // Otherwise try to extract raw JSON by finding the outermost braces
  const cleaned = text.trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No valid JSON found in response");
  }
  
  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
} 