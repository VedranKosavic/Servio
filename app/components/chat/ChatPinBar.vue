<script setup lang="ts">
/**
 * *Za naručiti* — the pinned note under the channel header.
 *
 * It is a note, not a ledger: `chat_channels.pinned_text` is a mutable column
 * and every change also posts a system line, so the thread keeps every version
 * of it while the bar shows only the current one.
 *
 * The bar collapses to its first line and opens on a tap, because the list of
 * things to order gets long by Thursday and the messages under it matter more.
 * *Naručeno ✓* clears it and is the owner's alone.
 */
const props = defineProps<{
  text: string | null
  /** Only an admin clears the note — the server refuses everyone else. */
  canClear?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ clear: [] }>()

const open = ref(false)
const lines = computed(() => (props.text ?? '').split('\n').filter(line => line.length > 0))
</script>

<template>
  <div v-if="lines.length > 0" class="card-2 -mx-1 flex flex-col gap-1 px-3 py-2">
    <button
      type="button"
      class="flex min-h-12 items-center gap-2 text-left"
      @click="open = !open"
    >
      <span class="chip chip-warn shrink-0">Za naručiti</span>
      <span class="grow truncate text-text">{{ lines[0] }}</span>
      <span v-if="lines.length > 1" class="shrink-0 text-label text-text-2">
        {{ open ? 'manje' : `+${lines.length - 1}` }}
      </span>
    </button>

    <ul v-if="open && lines.length > 1" class="flex flex-col gap-0.5 pb-1 pl-1">
      <li v-for="(line, i) in lines.slice(1)" :key="i" class="text-text-2">
        {{ line }}
      </li>
    </ul>

    <button
      v-if="canClear"
      type="button"
      class="btn btn-ghost min-h-12 self-start px-3 text-body"
      :disabled="busy"
      @click="emit('clear')"
    >
      Naručeno ✓
    </button>
  </div>
</template>
