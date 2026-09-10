<script setup lang="ts">
/**
 * The bar across the top of every bartender screen (`/sanker`, `/sanker/cekanje`,
 * `/stanje`).
 *
 * It exists because those three screens carried three copies of the same header
 * and all three broke the same way at 390 px: a title, a full-sentence sync chip,
 * an avatar and sometimes an action shared one row, so *Stanje šanka* rendered as
 * a lone "S" and *Servio · narudžbe* as "Servio · narud…".
 *
 * So the title owns the row and cannot be squeezed. The chip is drawn `compact` —
 * colour, icon and the outbox count, with the whole sentence still on its
 * `aria-label` — and anything else a screen wants goes underneath in the page,
 * never into this bar.
 *
 * The wordmark is deliberately **not** here. A working screen is not a place to
 * put the product's name: the bartender knows which app he is holding, and
 * *Narudžbe* is the word he needs. `APP_NAME` stays on the lock screen and in
 * `/admin`'s rail (docs/DESIGN.md §6).
 *
 * `SankerHeader` is the auto-import name: Nuxt names a component after its folder
 * plus its file, and this file already starts with its folder.
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
  <header class="s-head">
    <div class="s-titles">
      <h1 class="page-title s-title">{{ title }}</h1>
      <p v-if="subtitle" class="s-sub">{{ subtitle }}</p>
    </div>

    <WaiterSyncChip compact />

    <button
      type="button"
      class="avatar s-avatar"
      aria-label="Korisnik i meni"
      @click="emit('menu')"
    >
      {{ me.user.value?.initials ?? '?' }}
    </button>
  </header>
</template>

<style scoped>
/**
 * Sticky, so the title stays put while a queue of tickets scrolls under it. The
 * negative margin cancels the layout's `px-4` column so the rule under the bar
 * runs the full width of the phone.
 */
.s-head {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  margin: 0 -16px;
  padding: 8px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--line-soft);
}

.s-titles {
  flex: 1;
  min-width: 0;
}

.s-title {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-sub {
  margin: 2px 0 0;
  font-size: var(--text-label);
  color: var(--muted);
}

/* 48 px, not the primitive's 44: this is a phone screen and it is a thumb. */
.s-avatar {
  width: 48px;
  height: 48px;
  cursor: pointer;
}
</style>
