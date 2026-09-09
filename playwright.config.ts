import { defineConfig, devices } from '@playwright/test'

/**
 * The scripted night (docs/PHASE3.md §5).
 *
 * One Chromium project at 390 × 844 with `isMobile`, because every number in
 * §4's tap budget and every layout rule in this app is about a phone held in one
 * hand. A desktop viewport would pass tests the café would fail.
 *
 * **Port 3112, never 3002.** 3002 is the owner's dev server and it holds real
 * evenings; `data/sank.db` is that database. Everything here runs against
 * `data/verify.db` on 3112 and touches neither.
 *
 * `webServer` is deliberately absent: the run is against a *production* build
 * (`npm run build` then `node .output/server/index.mjs`), because the service
 * worker and the manifest do not exist under `npm run dev` — see the
 * `devOptions` note in `nuxt.config.ts`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SANK_E2E_URL ?? 'http://localhost:3112',
    trace: 'off',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
})
