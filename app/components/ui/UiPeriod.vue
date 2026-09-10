<script setup lang="ts">
/**
 * *Period* — the six presets and, on *Prilagođeno*, two date inputs.
 *
 * It owns no state of its own: `useAdminPeriod()` keeps the range in the route
 * query, so a reload comes back on the same period and a link opens on it.
 */
const period = useAdminPeriod()

const from = ref(period.range.value.from)
const to = ref(period.range.value.to)

watch(period.range, (next) => {
  from.value = next.from
  to.value = next.to
})

function applyCustom() {
  if (from.value && to.value) period.setCustom(from.value, to.value)
}
</script>

<template>
  <div class="a-period">
    <div class="a-period-keys">
      <button
        v-for="option in PERIOD_OPTIONS"
        :key="option.key"
        type="button"
        class="a-chip"
        :class="{ on: option.key === period.key.value }"
        :aria-pressed="option.key === period.key.value"
        @click="period.setPeriod(option.key)"
      >{{ option.label }}</button>
    </div>

    <div v-if="period.key.value === 'prilagodjeno'" class="a-period-dates">
      <UiField v-model="from" label="Od" kind="date" @change="applyCustom" />
      <UiField v-model="to" label="Do" kind="date" @change="applyCustom" />
      <UiButton variant="soft" @click="applyCustom">Primijeni</UiButton>
    </div>

    <p class="a-period-label">{{ period.label.value }}</p>
  </div>
</template>

<style scoped>
.a-period {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.a-period-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.a-chip {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-chip);
  border: 1px solid var(--line);
  background: var(--surface);
  font: inherit;
  font-size: var(--text-label);
  font-weight: 500;
  color: var(--ink-2);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard);
}

.a-chip:hover { border-color: var(--muted); color: var(--ink); }

/* A period is a filter, not the thing the page is for, so the chosen chip is a
   copper *tint* — the solid fill stays reserved for the one primary button. */
.a-chip.on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent-text);
  font-weight: 600;
}

.a-period-dates {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.a-period-label {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1023px) {
  .a-chip { height: 44px; padding: 0 16px; font-size: var(--text-body); }
  .a-period-keys { gap: 8px; }
}
</style>
