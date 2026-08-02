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
    /*
     * `scripts/` carries the drift check for the Edge Function's vendored copy
     * of the reminder engine. It belongs in the same gate as everything else,
     * because a stale copy means the daily job and the screen showing the same
     * reminders quietly disagree.
     */
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
