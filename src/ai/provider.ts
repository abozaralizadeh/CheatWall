import type { Level } from '../content.ts';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface TopicCheck {
  allowed: boolean;
  reason?: string;
  // Gets an extra note on the poster.
  sensitive?: 'health' | 'legal' | 'finance' | null;
}

export interface Result<T> {
  value: T;
  usage: Usage;
}

// The provider returns poster content as unknown. The pipeline validates it, so a provider can never skip validation.
export interface TextProvider {
  // Stored with each poster, e.g. "fake-local" or "claude-opus-5-5".
  readonly name: string;
  checkTopic(topic: string, level: Level | null): Promise<Result<TopicCheck>>;
  writePoster(topic: string, level: Level | null): Promise<Result<unknown>>;
  reviewPoster(topic: string, level: Level | null, content: unknown): Promise<Result<unknown>>;
  // overflow is how many times too big the content was, e.g. 1.2 means cut roughly a sixth.
  shortenPoster(topic: string, content: unknown, overflow: number): Promise<Result<unknown>>;
}

// Thrown when the model itself declines. The pipeline turns this into a "refused" poster.
export class ProviderRefusal extends Error {
  constructor(message = 'The AI declined to make a poster for this topic.') {
    super(message);
    this.name = 'ProviderRefusal';
  }
}
