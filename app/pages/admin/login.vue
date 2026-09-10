<script setup lang="ts">
/**
 * `/admin/login` — the owner's laptop. Email and password, and nothing else.
 *
 * `layout: false`: a login screen has no nav, so it brings the light theme with
 * it (the same `admin.css` the layout imports) instead of the shell.
 *
 * Two behaviours worth naming:
 *
 * - **The 401 never says which half was wrong.** "Pogrešan email ili lozinka" is
 *   one sentence for a wrong address and for a wrong password, because "no such
 *   email" is a free answer to somebody working through a list of addresses. The
 *   sentence comes from `shared/errors.ts` through `apiErrorText`, which also
 *   fills in the seconds on a lockout.
 * - **`autocomplete` is set**, so a password manager fills both fields. There is
 *   no "remember me": the session cookie already lasts thirty days.
 */
definePageMeta({ layout: false })

const api = useAdminApi()
const me = useMe()

useHead({
  title: 'Prijava',
  htmlAttrs: { 'data-theme': 'light' },
  // Both faces are loaded app-wide in `nuxt.config.ts` (docs/DESIGN.md §1).
  meta: [{ name: 'theme-color', content: THEME_COLOR_LIGHT }],
})

const email = ref('')
const password = ref('')
const pending = ref(false)
const error = ref('')

async function submit() {
  if (pending.value) return
  error.value = ''
  pending.value = true
  try {
    await api.adminLogin({ email: email.value.trim(), password: password.value })
    // The answer is a full `MeContext`, but the session envelope is read back
    // from `/api/me` all the same: one parser, one shape, and no second place
    // where a session gets assembled by hand.
    await me.refreshAfterLogin()
    await navigateTo('/admin')
  } catch (err) {
    error.value = apiErrorText(err)
    password.value = ''
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="a-login glow-ground" data-theme="light">
    <div class="a-login-inner">
      <!-- The same brand block as the lock screen, at the same three sizes:
           the owner's laptop door and the staff phone's door are one product. -->
      <header class="a-login-brand">
        <svg
          class="a-login-mark" viewBox="0 0 32 32" width="40" height="40"
          aria-hidden="true" focusable="false"
        >
          <rect
            x="0.75" y="0.75" width="30.5" height="30.5" rx="9.5"
            fill="var(--accent-soft)" stroke="var(--accent-line)" stroke-width="1.5"
          />
          <path
            d="M21 11.6a5 5 0 0 0-4.9-2.9c-2.6 0-4.3 1.3-4.3 3.3 0 4.3 9.4 2.5 9.4 6.9 0 2.2-1.9 3.6-4.7 3.6A5.4 5.4 0 0 1 11 19"
            fill="none" stroke="var(--accent)" stroke-width="2.1" stroke-linecap="round"
          />
        </svg>
        <h1 class="a-login-name">{{ APP_NAME }}</h1>
        <p class="a-login-tagline">{{ APP_TAGLINE }}</p>
      </header>

      <form class="a-login-card" @submit.prevent="submit">
        <div class="a-login-head">
          <h2>Prijava</h2>
          <p>Email i lozinka vlasnika</p>
        </div>

        <UiField
          v-model="email"
          label="Email"
          kind="email"
          autocomplete="email"
          placeholder="haris@lounge.ba"
        />

        <UiField
          v-model="password"
          label="Lozinka"
          kind="password"
          autocomplete="current-password"
        />

        <p v-if="error" class="a-login-error" role="alert">{{ error }}</p>

        <UiButton type="submit" variant="primary" :pending="pending">Prijavi se</UiButton>
      </form>
    </div>
  </div>
</template>

<style>
@import "~/assets/css/admin.css";
</style>

<style scoped>
.a-login {
  min-height: 100dvh;
  background: var(--bg);
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
}

/* One centred composition at both widths, 400 px wide at most — the same shape
   as the lock screen, so the product has one door and not two. */
.a-login-inner {
  width: min(400px, 100%);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
}

.a-login-brand { display: flex; flex-direction: column; align-items: center; }
.a-login-mark { display: block; }

.a-login-name {
  margin: 12px 0 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.05;
}

.a-login-tagline {
  margin: 8px 0 0;
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.a-login-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-pop);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.a-login-head { display: flex; flex-direction: column; gap: 3px; }

.a-login-head h2 {
  margin: 0;
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: -0.005em;
}

.a-login-head p { margin: 0; color: var(--muted); font-size: var(--text-micro); }

.a-login-error {
  margin: 0;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: var(--radius-field);
  padding: 10px 14px;
  font-size: var(--text-label);
  font-weight: 500;
}

/* The button is full width here — it is the only action on the screen. */
.a-login-card :deep(.a-btn) { width: 100%; height: 46px; font-size: var(--text-body); }
</style>
