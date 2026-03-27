import OpenAI from "openai";

export class AIService {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async ask(question: string, systemPrompt?: string | null): Promise<string> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    } else {
      messages.push({
        role: "system",
        content: "You are a helpful assistant for a university Discord server. Answer questions clearly and concisely.",
      });
    }

    messages.push({ role: "user", content: question });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 1024,
    });

    return response.choices[0]?.message?.content ?? "I couldn't generate a response.";
  }
}
