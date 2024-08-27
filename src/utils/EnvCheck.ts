import dotenv from 'dotenv';
import Logger from './Logger';

dotenv.config();

export function checkEnvironmentVariables() {
  const {
    OPENAI_API_KEY,
    LANGCHAIN_API_KEY,
    GROQ_API_KEY,
    ANTHROPIC_API_KEY,
    MEMORY_STORAGE_SUPABASE_URL,
    MEMORY_STORAGE_SUPABASE_KEY,
    METABASE_URL,
    METABASE_USERNAME,
    METABASE_PASSWORD,
    CUBE_API_SERVER_URL,
    PG_HOST,
    PG_PORT,
    PG_USER,
    PG_PASSWORD,
    PG_DATABASE
  } = process.env;

  const missingApiKeys: string[] = [];

  if (!OPENAI_API_KEY) missingApiKeys.push('OPENAI_API_KEY');
  if (!GROQ_API_KEY) missingApiKeys.push('GROQ_API_KEY');
  if (!ANTHROPIC_API_KEY) missingApiKeys.push('ANTHROPIC_API_KEY');
  if (!METABASE_URL) missingApiKeys.push('METABASE_URL');
  if (!METABASE_USERNAME) missingApiKeys.push('METABASE_USERNAME');
  if (!METABASE_PASSWORD) missingApiKeys.push('METABASE_PASSWORD');

  if (missingApiKeys.length === 6) {
    throw new Error(
      'All API keys (OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, METABASE_URL, METABASE_USERNAME, METABASE_PASSWORD) are missing. Please provide at least one API key.',
    );
  } else if (missingApiKeys.length > 0) {
    Logger.warn(`Warning: The following API keys are missing: ${missingApiKeys.join(', ')}`);
  }

  if (!LANGCHAIN_API_KEY) {
    Logger.warn('Warning: The LANGCHAIN_API_KEY environment variable is not set. LangChain API activity logging will be disabled.');
  }

  if (!MEMORY_STORAGE_SUPABASE_URL) {
      Logger.warn('Warning: The MEMORY_STORAGE_SUPABASE_URL environment variable is not set. Memory storage via Supabase will be disabled.');
  }

  if (!MEMORY_STORAGE_SUPABASE_KEY) {
      Logger.warn('Warning: The MEMORY_STORAGE_SUPABASE_KEY environment variable is not set. Memory storage via Supabase will be disabled.');
  }

  if (!CUBE_API_SERVER_URL) {
      Logger.warn('Warning: The CUBE_API_SERVER_URL environment variable is not set. Cube.js API server integration will be disabled.');
  }

  if (!PG_HOST) {
      Logger.warn('Warning: The PG_HOST environment variable is not set. PostgreSQL database connection will be disabled.');
  }

  if (!PG_PORT) {
      Logger.warn('Warning: The PG_PORT environment variable is not set. PostgreSQL database connection will be disabled.');
  }

  if (!PG_USER) {
      Logger.warn('Warning: The PG_USER environment variable is not set. PostgreSQL database connection will be disabled.');
  }

  if (!PG_PASSWORD) {
      Logger.warn('Warning: The PG_PASSWORD environment variable is not set. PostgreSQL database connection will be disabled.');
  }

  if (!PG_DATABASE) {
      Logger.warn('Warning: The PG_DATABASE environment variable is not set. PostgreSQL database connection will be disabled.');
  }
}