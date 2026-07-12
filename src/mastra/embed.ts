import { VoyageAIClient } from 'voyageai';
import type { Config } from '../config';

export const MULTIMODAL_MODEL = 'voyage-multimodal-3.5';
export const MONGODB_VOYAGE_BASE_URL = 'https://ai.mongodb.com/v1';

export interface MultimodalInput { content: { type: 'text'; text: string }[]; }

/** Wrap plain text into the object-shaped inputs the Voyage multimodal API requires. */
export function buildMultimodalInputs(texts: string[]): MultimodalInput[] {
  return texts.map(text => ({ content: [{ type: 'text', text }] }));
}

/** Minimal structural view of the SDK method we depend on (keeps the unit test hermetic). */
export interface MultimodalEmbedClient {
  multimodalEmbed(request: {
    inputs: MultimodalInput[]; model: string; inputType?: 'query' | 'document';
  }): Promise<{ data?: { index?: number; embedding?: number[] }[] }>;
}

export interface VoyageEmbedder { embedQuery(query: string): Promise<number[]>; }

export function createVoyageEmbedder(deps: { client: MultimodalEmbedClient; model?: string }): VoyageEmbedder {
  const model = deps.model ?? MULTIMODAL_MODEL;
  return {
    async embedQuery(query: string): Promise<number[]> {
      const res = await deps.client.multimodalEmbed({
        inputs: buildMultimodalInputs([query]), model, inputType: 'query',
      });
      const rows = res.data ?? [];
      const first = rows.find(r => (r.index ?? 0) === 0) ?? rows[0];
      return first?.embedding ?? [];
    },
  };
}

/** Resolve the Voyage base URL: explicit config wins, else the MongoDB-hosted default. */
export function resolveVoyageBaseUrl(cfg: Config): string {
  return cfg.voyageBaseUrl ?? MONGODB_VOYAGE_BASE_URL;
}

function voyageClient(cfg: Config): VoyageAIClient {
  return new VoyageAIClient({ apiKey: cfg.voyageApiKey, baseUrl: resolveVoyageBaseUrl(cfg) } as any);
}

/** Construct a VoyageEmbedder backed by a live VoyageAIClient from config. */
export function getQueryEmbedder(cfg: Config): VoyageEmbedder {
  return createVoyageEmbedder({ client: voyageClient(cfg) as unknown as MultimodalEmbedClient, model: MULTIMODAL_MODEL });
}
