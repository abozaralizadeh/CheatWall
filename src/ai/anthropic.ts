import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Level } from '../content.ts';
import { posterSchema } from '../content.ts';
import { prompts, SYSTEM } from './prompts.ts';
import { OutputCutOff, ProviderRefusal, type Result, type TextProvider, type TopicCheck, type Usage } from './provider.ts';

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
  maxOutputTokens?: number;
}

export class AnthropicProvider implements TextProvider {
  readonly name: string;
  private client: ParseClient;
  private model: string;
  private maxOut: number;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.maxOut = opts.maxOutputTokens ?? 16_000;
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
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    if (response.stop_reason === 'max_tokens') throw new OutputCutOff(usage);
    return { value: response.parsed_output, usage };
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

  writePoster(topic: string, level: Level | null, problems?: string): Promise<Result<unknown>> {
    return this.run(
      prompts.write(topic, level, problems),
      zodOutputFormat(posterSchema),
      this.maxOut,
    );
  }

  reviewPoster(topic: string, level: Level | null, content: unknown): Promise<Result<unknown>> {
    return this.run(
      prompts.review(topic, level, content),
      zodOutputFormat(posterSchema),
      this.maxOut,
    );
  }

  shortenPoster(topic: string, content: unknown, overflow: number): Promise<Result<unknown>> {
    return this.run(
      prompts.shorten(topic, content, overflow),
      zodOutputFormat(posterSchema),
      this.maxOut,
    );
  }
}
