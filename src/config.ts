import { z } from 'zod';

export interface Config {
  appName: string;
  mongoUri: string;
  mongoDb: string;
  voyageApiKey: string;
  voyageBaseUrl?: string;
  llmProvider: 'anthropic' | 'openai' | 'bedrock';
  llmModel: string;
  llmBaseUrl?: string;
  llmGatewayApiKey?: string;
  bedrockRegion?: string;
  port: number;
  rrfK: number;
  /** HMAC secret for the append-only audit chain. Host-side only; never stored in records. */
  auditSecret: string;
}

const EnvSchema = z.object({
  APP_NAME: z.string().min(1).default('Marshal'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().min(1).default('marshal'),
  VOYAGE_API_KEY: z.string().min(1, 'VOYAGE_API_KEY is required'),
  VOYAGE_BASE_URL: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'bedrock']).default('anthropic'),
  LLM_MODEL: z.string().min(1).default('claude-haiku-4-5'),
  LLM_BASE_URL: z.string().optional(),
  // Gateway key sent as the `api-key` header when LLM_BASE_URL points at an APIM gateway.
  GROVE_API_KEY: z.string().optional(),
  BEDROCK_REGION: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8000),
  RRF_K: z.coerce.number().int().positive().default(60),
  AUDIT_SECRET: z.string().min(1).default('marshal-dev-audit-secret'),
});

export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  const e = EnvSchema.parse(env);
  return {
    appName: e.APP_NAME,
    mongoUri: e.MONGODB_URI,
    mongoDb: e.MONGODB_DB,
    voyageApiKey: e.VOYAGE_API_KEY,
    voyageBaseUrl: e.VOYAGE_BASE_URL,
    llmProvider: e.LLM_PROVIDER,
    llmModel: e.LLM_MODEL,
    llmBaseUrl: e.LLM_BASE_URL,
    llmGatewayApiKey: e.GROVE_API_KEY,
    bedrockRegion: e.BEDROCK_REGION,
    port: e.PORT,
    rrfK: e.RRF_K,
    auditSecret: e.AUDIT_SECRET,
  };
}
