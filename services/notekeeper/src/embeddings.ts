import { createHash } from 'node:crypto';

export interface EmbeddingProvider {
  modelId: string;
  embed(texts: string[]): Promise<Float32Array[]>;
  health(): Promise<boolean>;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Real Ollama local embedding provider using nomic-embed-text.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly baseUrl: string;

  constructor(options: { modelId?: string; baseUrl?: string } = {}) {
    this.modelId =
      options.modelId ||
      process.env.EMBED_MODEL ||
      process.env.OLLAMA_EMBED_MODEL ||
      'nomic-embed-text';
    this.baseUrl =
      options.baseUrl ||
      process.env.OLLAMA_HOST ||
      'http://127.0.0.1:11434';
  }

  async health(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    // Try batch /api/embed first
    try {
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelId,
          input: texts,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { embeddings?: number[][] };
        if (Array.isArray(data.embeddings)) {
          return data.embeddings.map((vec) => new Float32Array(vec));
        }
      }
    } catch {
      // fallback to per-prompt /api/embeddings
    }

    // Fallback: per-item /api/embeddings
    const results: Float32Array[] = [];
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelId,
          prompt: text,
        }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embedding error: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { embedding: number[] };
      results.push(new Float32Array(data.embedding));
    }
    return results;
  }
}

/**
 * Deterministic hash-based embedding for reproducible structural tests without network.
 */
export class DeterministicFakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'fake-deterministic';
  readonly dimensions = 32;
  isHealthy = true;

  async health(): Promise<boolean> {
    return this.isHealthy;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vec = new Float32Array(this.dimensions);
      const hash = createHash('sha256').update(text).digest();
      for (let i = 0; i < this.dimensions; i++) {
        vec[i] = (hash[i % hash.length] - 128) / 128.0;
      }
      // Normalize
      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < vec.length; i++) vec[i] /= norm;
      }
      return vec;
    });
  }
}

/**
 * Concept-based fake embedding provider specifically for the paraphrase acceptance test.
 * Maps semantic clusters of words to shared vector dimensions with zero shared keyword requirement.
 */
export class ConceptFakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'concept-fake';
  readonly dimensions = 16;
  isHealthy = true;

  private static conceptMap: Record<string, number> = {
    // Automobile cluster -> dimension 0
    car: 0,
    automobile: 0,
    vehicle: 0,
    auto: 0,
    motor: 0,

    // Repair/mechanic cluster -> dimension 1
    repair: 1,
    mechanic: 1,
    fix: 1,
    maintenance: 1,
    appointment: 1,
    servicing: 1,

    // Software/tech cluster -> dimension 2
    software: 2,
    code: 2,
    program: 2,
    quantum: 2,
    mcp: 2,

    // Food cluster -> dimension 3
    food: 3,
    apple: 3,
    recipe: 3,
    kitchen: 3,
    grocery: 3,
  };

  async health(): Promise<boolean> {
    return this.isHealthy;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vec = new Float32Array(this.dimensions);
      const words = text.toLowerCase().split(/\W+/);

      for (const w of words) {
        if (ConceptFakeEmbeddingProvider.conceptMap[w] !== undefined) {
          const dim = ConceptFakeEmbeddingProvider.conceptMap[w];
          vec[dim] += 2.0;
        }
      }

      // Small background hash across dimensions 4..15
      const hash = createHash('md5').update(text).digest();
      for (let i = 4; i < this.dimensions; i++) {
        vec[i] += (hash[i] - 128) / 512.0;
      }

      // Normalize to unit vector
      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < vec.length; i++) vec[i] /= norm;
      }
      return vec;
    });
  }
}
