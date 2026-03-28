import OpenAI from "openai";

export class AIService {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async ask(question: string, systemPrompt?: string | null): Promise<string> {
    const safetyPrefix = "You are a helpful assistant for Drexel University that uses the responses on a Discord server. Keep responses concise (in a paragraph or a few sentences";

    const instructions = systemPrompt
      ? `${safetyPrefix}\n\n${systemPrompt}`
      : `${safetyPrefix}\n\nAnswer questions clearly and concisely.`;

    const response = await this.client.responses.create({
      model: this.model,
      instructions,
      input: question,
      tools: [{ type: "web_search_preview" }],
      max_output_tokens: 1024,
    });

    return response.output_text || "I couldn't generate a response.";
  }
}
