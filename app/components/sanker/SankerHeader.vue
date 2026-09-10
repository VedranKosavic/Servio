<script setup lang="ts">
/**
 * The bar across the top of every bartender screen (`/sanker`,
 * `/sanker/cekanje`, `/stanje`).
 *
 * It exists because those three screens carried three copies of the same header
 * and all three broke the same way at 390 px: a title, a full-sentence sync
 * chip, an avatar and sometimes an action shared one row, so *Stanje šanka*
 * rendered as a lone "S".
 *
 * **It is not a second header.** The sticky bar, the title step, the quiet line
 * under it and the negative margin that runs the rule to the edges all live in
 * `WaiterHeader`, which already took a `right` slot for exactly this. This file
 * is that header plus the two things every bartender screen puts on the right —
 * so the two areas cannot drift apart, because there is only one of them.
 *
 * The chip is drawn `compact` — colour, icon and the outbox count, with the
 * whole sentence still on its `aria-label` — and anything else a screen wants
 * goes underneath in the page, never into this bar.
 *
 * The wordmark is deliberately **not** here. A working screen is not a place to
 * put the product's name: the bartender knows which app he is holding, and
 * *Narudžbe* is the word he needs. `APP_NAME` stays on the lock screen and in
 * `/admin`'s rail (docs/DESIGN.md §6).
 *
 * `SankerHeader` is the auto-import name: Nuxt names a component after its
 * folder plus its file, and this file already starts with its folder.
 */
defineProps<{
  title: string
  /** A quiet second line under the title: a count, a state, a rule. */
  subtitle?: string
}>()

const emit = defineEmits<{ menu: [] }>()

const me = useMe()
</script>

<template>
  <WaiterHeader :title="title" :sub="subtitle">
    <template #right>
      <WaiterSyncChip compact />

      <button
        type="button"
        class="avatar s-avatar"
        aria-label="Korisnik i meni"
        @click="emit('menu')"
      >
        <!-- `me` only resolves on the client, so a fallback here is rendered
             into the server's HTML and then replaced — a literal "?" on screen
             until hydration, and a hydration mismatch in the console. Render
             nothing on the server instead. -->
        <ClientOnly>{{ me.user.value?.initials ?? '' }}</ClientOnly>
      </button>
    </template>
  </WaiterHeader>
</template>

<style scoped>
/* A thumb's target, not the avatar primitive's default. */
.s-avatar {
  width: var(--tap);
  height: var(--tap);
  cursor: pointer;
}
</style>
