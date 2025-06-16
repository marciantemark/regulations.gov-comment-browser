import { GoogleGenAI } from "@google/genai";
import { debugSave } from "./debug";
import { parseJsonResponse } from "./json-parser";

// const MODEL = "gemini-2.5-pro-preview-06-05";
const MODEL = "gemini-2.5-flash-preview-05-20"
const baseConfig = {
      thinkingConfig: {
        thinkingBudget: 24000,
      },
    };


export class AIClient {
  private ai: GoogleGenAI;
  
  constructor(apiKey: string = process.env.GEMINI_API_KEY!) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }
  
  async generateContent(prompt: string, debugPrefix?: string): Promise<string> {
    if (debugPrefix) {
      await debugSave(`${debugPrefix}_prompt.txt`, prompt);
    }
    
    const config = {...baseConfig, responseMimeType: "text/plain" };
    const contents = [{
      role: "user" as const,
      parts: [{ text: prompt }]
    }];
    
    const response = await this.ai.models.generateContentStream({
      model: MODEL,
      config,
      contents,
    });
    
    let result = "";
    for await (const chunk of response) {
      result += chunk.text;
    }
    
    if (debugPrefix) {
      await debugSave(`${debugPrefix}_response.txt`, result);
    }
    
    return result;
  }
  
  // Extract JSON from AI response (handles markdown code blocks)
  extractJson(text: string): any {
    return parseJsonResponse(text);
  }
}
