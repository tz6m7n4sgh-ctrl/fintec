import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the `@/*` path alias from tsconfig so tests resolve app-style imports.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    /*
     * `app/` is included for server actions whose *guards* run before any
     * Supabase client is constructed — the derived-row write refusal in
     * `app/schedule/actions.ts` (HAD-81) is the first of them. Anything past
     * that boundary needs a session and belongs to the manual pass (HAD-68).
     */
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
