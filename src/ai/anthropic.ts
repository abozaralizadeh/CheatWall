import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Level } from '../content.ts';
import { posterSchema } from '../content.ts';
import { prompts, SYSTEM } from './prompts.ts';
import { ProviderRefusal, type Result, type TextProvider, type TopicCheck, type Usage } from './provider.ts';

// The real provider. It has NEVER been run against the live API: the project has no key yet.
// It is covered by tests that use a mocked client only. Try it with a real key before trusting it.

const topicCheckSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  sensitive: z.enum(['health', 'legal', 'finance', 'none']),
});

// Narrow view of the SDK client so tests can pass a mock.
export interface ParseClient {
  messages: {
    parse(params: any): Promise<{ parsed_output: unknown; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } }>;
  };
}

export interface AnthropicOptions {
  apiKey?: string;
  model: string;
  client?: ParseClient;
}

export class AnthropicProvider implements TextProvider {
  readonly name: string;
  private client: ParseClient;
  private model: string;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.name = opts.model;
    this.client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as ParseClient);
  }

  private async run(prompt: string, format: ReturnType<typeof zodOutputFormat>, maxTokens: number): Promise<{ value: unknown; usage: Usage }> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format },
    });
    if (response.stop_reason === 'refusal') throw new ProviderRefusal();
    if (response.stop_reason === 'max_tokens') throw new Error('The AI ran out of room before it finished the poster.');
    return { value: response.parsed_output, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
  }

  async checkTopic(topic: string, level: Level | null): Promise<Result<TopicCheck>> {
    const r = await this.run(
      prompts.check(topic, level),
      zodOutputFormat(topicCheckSchema),
      1000,
    );
    const parsed = topicCheckSchema.parse(r.value);
    return {
      value: { allowed: parsed.allowed, reason: parsed.reason || undefined, sensitive: parsed.sensitive === 'none' ? null : parsed.sensitive },
      usage: r.usage,
    };
  }

  writePoster(topic: string, level: Level | null): Promise<Result<unknown>> {
    return this.run(
      prompts.write(topic, level),
      zodOutputFormat(posterSchema),
      16000,
    );
  }

  reviewPoster(topic: string, level: Level | null, content: unknown): Promise<Result<unknown>> {
    return this.run(
      prompts.review(topic, level, content),
      zodOutputFormat(posterSchema),
      16000,
    );
  }

  shortenPoster(topic: string, content: unknown, overflow: number): Promise<Result<unknown>> {
    return this.run(
      prompts.shorten(topic, content, overflow),
      zodOutputFormat(posterSchema),
      16000,
    );
  }
}
