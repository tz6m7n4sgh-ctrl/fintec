import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(url?: string, key?: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url ?? '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', key ?? '');
  return import('./config');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Supabase configuration', () => {
  it('has no committed fallback', async () => {
    const config = await loadConfig();

    expect(config.SUPABASE_URL).toBe('');
    expect(config.SUPABASE_PUBLISHABLE_KEY).toBe('');
    expect(config.isSupabaseConfigured()).toBe(false);
    expect(config.supabaseProjectHost()).toBeNull();
  });

  it('requires both environment variables', async () => {
    expect((await loadConfig('https://example.supabase.co')).isSupabaseConfigured()).toBe(false);
    expect((await loadConfig(undefined, 'sb_publishable_example')).isSupabaseConfigured()).toBe(false);
  });

  it('reports which explicitly configured project is in use', async () => {
    const config = await loadConfig(
      'https://project-ref.supabase.co',
      'sb_publishable_example',
    );

    expect(config.isSupabaseConfigured()).toBe(true);
    expect(config.supabaseProjectHost()).toBe('project-ref.supabase.co');
  });
});
