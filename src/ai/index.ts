import type { Config } from '../config.ts';
import { AnthropicProvider } from './anthropic.ts';
import { AzureOpenAIProvider } from './azure.ts';
import { FakeProvider } from './fake.ts';
import type { TextProvider } from './provider.ts';

export function createProvider(config: Config): TextProvider {
  if (config.provider === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment file.');
    return new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.model });
  }
  if (config.provider === 'azure') {
    const missing = (['endpoint', 'apiKey', 'deployment'] as const).filter((k) => !config.azure[k]);
    if (missing.length) throw new Error('PROVIDER=azure needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT in the environment file.');
    return new AzureOpenAIProvider({ main: config.azure, fallback: config.azureFallback, apiVersion: config.azureApiVersion });
  }
  return new FakeProvider();
}
