import dotenv from 'dotenv';
import Logger from './Logger';

dotenv.config();

interface ClientConfig {
  METABASE_URL: string;
  METABASE_USERNAME: string;
  METABASE_PASSWORD: string;
  PG_HOST: string;
  PG_PORT: string;
  PG_USER: string;
  PG_PASSWORD: string;
  PG_DATABASE: string;
  SUPABASE_PRIVATE_KEY: string;
  SUPABASE_URL: string;
  DATA_ASSISTANT_KEY: string;
}

export class ConfigurationManager {
  
  private static formatEnvKey(clientKey: string, envVar: string): string {
    return `${clientKey.toUpperCase()}_${envVar}`;
  }

  public static getConfig(clientKey: string): ClientConfig {
    const formattedClientKey = clientKey.toUpperCase().replace(/-/g, '_');
    
    const config: ClientConfig = {
      METABASE_URL: process.env[this.formatEnvKey(formattedClientKey, 'METABASE_URL')] || '',
      METABASE_USERNAME: process.env[this.formatEnvKey(formattedClientKey, 'METABASE_USERNAME')] || '',
      METABASE_PASSWORD: process.env[this.formatEnvKey(formattedClientKey, 'METABASE_PASSWORD')] || '',
      PG_HOST: process.env[this.formatEnvKey(formattedClientKey, 'PG_HOST')] || '',
      PG_PORT: process.env[this.formatEnvKey(formattedClientKey, 'PG_PORT')] || '',
      PG_USER: process.env[this.formatEnvKey(formattedClientKey, 'PG_USER')] || '',
      PG_PASSWORD: process.env[this.formatEnvKey(formattedClientKey, 'PG_PASSWORD')] || '',
      PG_DATABASE: process.env[this.formatEnvKey(formattedClientKey, 'PG_DATABASE')] || '',
      SUPABASE_PRIVATE_KEY: process.env[this.formatEnvKey(formattedClientKey, 'SUPABASE_PRIVATE_KEY')] || '',
      SUPABASE_URL: process.env[this.formatEnvKey(formattedClientKey, 'SUPABASE_URL')] || '',
      DATA_ASSISTANT_KEY: process.env['DATA_ASSISTANT_KEY'] || '',
    };

    return config;
  }

  public static checkEnvironmentVariables(clientKey: string) {
    const config = this.getConfig(clientKey);
    const missingVars = Object.entries(config)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingVars.length > 0) {
      Logger.warn(`Warning: The following environment variables are missing for ${clientKey}: ${missingVars.join(', ')}`);
    }
  }
}
