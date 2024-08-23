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
    Logger.warn('Warning: LANGCHAIN_API_KEY is not set. Activity logging will be disabled.');
  }

  if (!MEMORY_STORAGE_SUPABASE_URL) {
    Logger.warn('Warning: MEMORY_STORAGE_SUPABASE_URL is not set. Activity logging will be disabled.');
  }

  if (!MEMORY_STORAGE_SUPABASE_KEY) {
    Logger.warn('Warning: MEMORY_STORAGE_SUPABASE_KEY is not set. Activity logging will be disabled.');
  }

  if (!CUBE_API_SERVER_URL) {
    Logger.warn('Warning: CUBE_API_SERVER_URL is not set. Activity logging will be disabled.');
  }
}