import { z } from 'zod';
import type { AzureTarget } from '../config.ts';
import type { Level } from '../content.ts';
import { posterSchema } from '../content.ts';
import { OutputCutOff, ProviderRefusal, type Result, type TextProvider, type TopicCheck, type Usage } from './provider.ts';
import { prompts, SYSTEM } from './prompts.ts';

// Azure OpenAI chat completions with structured output. It tries the main deployment first and the fallback
// deployment when the main one is down, rate limited or missing. A refusal or a bad answer is never retried
// on the fallback, so one poster can't quietly cost twice.
// Like the Anthropic provider, it has only run against a mocked fetch so far.

const topicCheckSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  sensitive: z.enum(['health', 'legal', 'finance', 'none']),
});

// The poster schema without its custom checks. The pipeline validates the full schema afterwards.
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
}
const posterJsonSchema = jsonSchema(posterSchema);
const checkJsonSchema = jsonSchema(topicCheckSchema);

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface AzureOptions {
  main: AzureTarget;
  fallback?: AzureTarget;
  // Empty means the v1 API (/openai/v1/chat/completions). Set it to use the older /openai/deployments/... path.
  apiVersion?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  // Output limit for one poster call. Reasoning models count their thinking in it too.
  maxOutputTokens?: number;
}

// Worth trying the fallback for these: the main deployment is busy, broken or not there.
class Retryable extends Error {}

export function chatUrl(target: AzureTarget, apiVersion = ''): string {
  const base = target.endpoint.replace(/\/+$/, '').replace(/\/openai(\/v1)?$/, '');
  if (apiVersion) return `${base}/openai/deployments/${encodeURIComponent(target.deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  return `${base}/openai/v1/chat/completions`;
}

export class AzureOpenAIProvider implements TextProvider {
  readonly name: string;
  private targets: AzureTarget[];
  private apiVersion: string;
  private fetch: FetchLike;
  private timeoutMs: number;
  private maxOut: number;

  constructor(opts: AzureOptions) {
    const fb = opts.fallback;
    // The fallback may live on the same resource, so an empty endpoint or key means "same as the main one".
    const fallback = fb?.deployment ? { endpoint: fb.endpoint || opts.main.endpoint, apiKey: fb.apiKey || opts.main.apiKey, deployment: fb.deployment } : null;
    this.targets = fallback ? [opts.main, fallback] : [opts.main];
    this.apiVersion = opts.apiVersion ?? '';
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.maxOut = opts.maxOutputTokens ?? 32_000;
    this.name = `azure:${opts.main.deployment}`;
  }

  private async call(target: AzureTarget, prompt: string, schemaName: string, schema: unknown, maxTokens: number): Promise<{ value: unknown; usage: Usage }> {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: false } },
    };
    if (!this.apiVersion) body.model = target.deployment;
    let res;
    try {
      res = await this.fetch(chatUrl(target, this.apiVersion), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': target.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new Retryable(`network error: ${String(err)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      // Never log the body in full: it can echo the prompt. The status and error code are enough.
      let code = '';
      try { code = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? ''; } catch { /* not JSON */ }
      if (code === 'content_filter' || code === 'ResponsibleAIPolicyViolation') throw new ProviderRefusal();
      if (res.status === 408 || res.status === 404 || res.status === 429 || res.status >= 500) throw new Retryable(`HTTP ${res.status} ${code}`.trim());
      throw new Error(`Azure OpenAI answered HTTP ${res.status} ${code}`.trim());
    }
    const data = JSON.parse(text) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const usage: Usage = { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
    const choice = data.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new ProviderRefusal();
    if (choice?.finish_reason === 'length') throw new OutputCutOff(usage);
    const content = choice?.message?.content;
    if (!content) throw new Error('The AI sent an empty answer.');
    let value: unknown;
    try { value = JSON.parse(content); } catch { value = null; }
    return { value, usage };
  }

  private async run(prompt: string, schemaName: string, schema: unknown, maxTokens: number): Promise<{ value: unknown; usage: Usage }> {
    let last: unknown;
    for (const target of this.targets) {
      try {
        return await this.call(target, prompt, schemaName, schema, maxTokens);
      } catch (err) {
        if (!(err instanceof Retryable)) throw err;
        last = err;
      }
    }
    throw new Error(`Azure OpenAI is not answering (${(last as Error).message}).`);
  }

  async checkTopic(topic: string, level: Level | null): Promise<Result<TopicCheck>> {
    const r = await this.run(prompts.check(topic, level), 'topic_check', checkJsonSchema, 2000);
    const parsed = topicCheckSchema.parse(r.value);
    return {
      value: { allowed: parsed.allowed, reason: parsed.reason || undefined, sensitive: parsed.sensitive === 'none' ? null : parsed.sensitive },
      usage: r.usage,
    };
  }

  writePoster(topic: string, level: Level | null, problems?: string): Promise<Result<unknown>> {
    return this.run(prompts.write(topic, level, problems), 'poster', posterJsonSchema, this.maxOut);
  }

  reviewPoster(topic: string, level: Level | null, content: unknown): Promise<Result<unknown>> {
    return this.run(prompts.review(topic, level, content), 'poster', posterJsonSchema, this.maxOut);
  }

  shortenPoster(topic: string, content: unknown, overflow: number): Promise<Result<unknown>> {
    return this.run(prompts.shorten(topic, content, overflow), 'poster', posterJsonSchema, this.maxOut);
  }
}
