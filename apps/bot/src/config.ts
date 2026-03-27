import { z } from "zod";

const envSchema = z.object({
  DISCORD_API_TOKEN: z.string().min(1, "DISCORD_API_TOKEN is required"),
  BOT_CLIENT_ID: z.string().min(1, "BOT_CLIENT_ID is required"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  RESEND_FROM_EMAIL: z.string().email("RESEND_FROM_EMAIL must be a valid email"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  WEBAPP_URL: z.string().url("WEBAPP_URL must be a valid URL"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`Invalid environment variables:\n${formatted}`);
    process.exit(1);
  }
  return result.data;
}
