<script setup lang="ts">
/**
 * The container everything on `/a` sits in: `--surface`, a 1 px `--line`,
 * radius 12, and **no shadow** — the light theme separates things with a rule,
 * not with a drop shadow.
 *
 * `count` is the small grey number beside a title ("Zahtijeva pažnju · 3").
 */
defineProps<{
  title?: string
  /** Rendered in `--muted` after the title. A string, so "3 stavke" works too. */
  count?: string | number
}>()
</script>

<template>
  <section class="a-card">
    <header v-if="title || $slots.title || $slots.actions" class="a-card-head">
      <h2 v-if="title || $slots.title">
        <slot name="title">{{ title }}</slot>
        <span v-if="count !== undefined" class="a-card-count">{{ count }}</span>
      </h2>
      <div v-if="$slots.actions" class="a-card-actions"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.a-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.a-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.a-card-head h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.a-card-count {
  font-size: 13px;
  color: var(--muted);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.a-card-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
