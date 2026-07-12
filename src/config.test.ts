import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const base = { MONGODB_URI: 'mongodb+srv://x', VOYAGE_API_KEY: 'vk' };

describe('loadConfig', () => {
  it('defaults the app name to Marshal', () => {
    expect(loadConfig(base).appName).toBe('Marshal');
  });
  it('overrides the app name from APP_NAME', () => {
    expect(loadConfig({ ...base, APP_NAME: 'Case Zero' }).appName).toBe('Case Zero');
  });
  it('requires MONGODB_URI', () => {
    expect(() => loadConfig({ VOYAGE_API_KEY: 'vk' })).toThrow(/MONGODB_URI/);
  });
  it('defaults db, provider, model, port, rrfK', () => {
    const c = loadConfig(base);
    expect(c.mongoDb).toBe('marshal');
    expect(c.llmProvider).toBe('anthropic');
    expect(c.llmModel).toBe('claude-haiku-4-5');
    expect(c.port).toBe(8000);
    expect(c.rrfK).toBe(60);
  });
});
