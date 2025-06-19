import { GoogleGenAI } from "@google/genai";

// Simple provider functions that just handle the generation call
// Cache logic remains in AIClient

export async function generateWithGeminiPro(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const config = { responseMimeType: "text/plain" };
  const contents = [{
    role: "user" as const,
    parts: [{ text: prompt }]
  }];
  
  const response = await ai.models.generateContentStream({
    model: "gemini-2.5-pro-preview-06-05",
    config,
    contents,
  });
  
  let result = "";
  for await (const chunk of response) {
    result += chunk.text;
  }
  
  return result;
}

export async function generateWithGeminiFlash(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const config = { 
    responseMimeType: "text/plain",
    thinkingConfig: {
      thinkingBudget: 14000,
    }
  };
  const contents = [{
    role: "user" as const,
    parts: [{ text: prompt }]
  }];
  
  const response = await ai.models.generateContentStream({
    model: "gemini-2.5-flash-preview-05-20",
    config,
    contents,
  });
  
  let result = "";
  for await (const chunk of response) {
    result += chunk.text;
  }
  
  return result;
}

export async function generateWithGeminiFlashLite(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const config = { 
    responseMimeType: "text/plain",
    // thinkingConfig: {
    //   thinkingBudget: 14000,
    // }
  };
  const contents = [{
    role: "user" as const,
    parts: [{ text: prompt }]
  }];
  
  const response = await ai.models.generateContentStream({
    model: "gemini-2.5-flash-lite-preview-06-17",
    config,
    contents,
  });
  
  let result = "";
  for await (const chunk of response) {
    result += chunk.text;
  }
  
  return result;
}

export async function generateWithClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }
  
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      temperature: 0,
      messages: [{
        role: "user",
        content: prompt
      }]
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return data.content[0].text;
}

// Map of model names to generation functions
export const MODEL_FUNCTIONS = {
  "gemini-pro": generateWithGeminiPro,
  "gemini-flash": generateWithGeminiFlash,
  "gemini-flash-lite": generateWithGeminiFlashLite,
  "claude": generateWithClaude
} as const;

export type ModelName = keyof typeof MODEL_FUNCTIONS;

// Get the appropriate generation function based on model selection
export function getGenerationFunction(model: string = "gemini-pro") {
  const fn = MODEL_FUNCTIONS[model as ModelName];
  if (!fn) {
    throw new Error(`Unknown model: ${model}. Available: ${Object.keys(MODEL_FUNCTIONS).join(", ")}`);
  }
  return fn;
}