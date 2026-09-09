import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      // scrypt is slow **on purpose** — that is the whole point of it. 2^14 is
      // the production cost (~50 ms a hash); a suite that seeds a fresh venue
      // per test would spend minutes there and nobody would run it. `N` is part
      // of the stored hash string, so verification needs no flag to know which
      // cost was used and the code path under test is identical.
      SANK_SCRYPT_LOG2N: '10',
      // A fixed pepper, so a hash written by one test verifies in the next.
      // The real one lives only in /opt/sank/.env.
      PIN_PEPPER: 'test-pepper',
    },
  },
  // Nuxt gives `shared/` the `#shared` alias in the app and in Nitro; vitest
  // runs these modules outside both, so it needs to be told the same thing.
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
})
