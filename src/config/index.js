import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  COOKIE_SECRET: z.string().min(24),
  COOKIE_MAX_AGE_DAYS: z.coerce.number().int().positive().default(365),
  SDR_LINK_PEPPER: z.string().min(24),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_VECTOR_STORE_ID: z.string().trim().min(1, 'OPENAI_VECTOR_STORE_ID is required'),
  GOOGLE_DRIVE_FOLDER_ID: z.string().min(1,'GOOGLE_DRIVE_FOLDER_ID is required'),
  GOOGLE_DRIVE_OLD_VERSIONS_FOLDER_ID:z.string().trim().min(1,'GOOGLE_DRIVE_OLD_VERSIONS_FOLDER_ID is required'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(1),
  ADMIN_DASHBOARD_KEY: z.string().min(16,'ADMIN_DASHBOARD_KEY must contain at least 16 characters'),
  KNOWLEDGE_SYNC_CRON: z.string().default('*/15 * * * *'),
  TRIAL_REGISTRATION_URL:z.string().url(),
  LIVEAVATAR_API_KEY: z.string().min(1),
  LIVEAVATAR_AVATAR_ID: z.string().min(1),
  LIVEAVATAR_VOICE_ID: z.string().min(1),
  LIVEAVATAR_CONTEXT_ID: z.string().min(1),
  LIVEAVATAR_CUSTOM_LLM_BASE_URL: z.string().url()
});

export const config = envSchema.parse(process.env);

// dotenv preserves the literal "\\n" characters; Google expects real new lines.
export const googleCredentials = {
  client_email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  private_key: config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
};
