import type { Config } from '../config.ts';
import { AnthropicProvider } from './anthropic.ts';
import { FakeProvider } from './fake.ts';
import type { TextProvider } from './provider.ts';

export function createProvider(config: Config): TextProvider {
  if (config.provider === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment file.');
    return new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.model });
  }
  return new FakeProvider();
}
