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
  meta: [{ name: 'theme-color', content: '#1f2a2e' }],
  link: [{
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap',
  }],
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
  <div class="a-login" data-theme="light">
    <form class="a-login-card" @submit.prevent="submit">
      <div class="a-login-brand">
        Šank
        <small>Kontrolna ploča</small>
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

.a-login-card {
  width: min(380px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.a-login-brand {
  font-family: var(--font-title);
  font-weight: 800;
  font-size: 30px;
  letter-spacing: -0.02em;
  line-height: 1.05;
}

.a-login-brand small {
  display: block;
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-top: 4px;
}

.a-login-error {
  margin: 0;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
}

/* The button is full width here — it is the only action on the screen. */
.a-login-card :deep(.a-btn) { width: 100%; height: 44px; font-size: 15px; }
</style>
