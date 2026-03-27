import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  DISCORD_API_TOKEN: z.string().min(1),
});

type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

function getEnv(): Env {
  if (_env) return _env;

  // In dev, load from monorepo root .env file
  if (process.env.NODE_ENV !== "production") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dotenv = require("dotenv");
      dotenv.config({ path: "../../.env" });
    } catch {
      // dotenv not available, env vars should be set externally
    }
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment variables: ${result.error.message}`);
  }
  _env = result.data;
  return _env;
}

export const env = new Proxy({} as Env, {
  get(_, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
