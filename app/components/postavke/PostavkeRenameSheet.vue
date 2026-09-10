<script setup lang="ts">
/**
 * Renaming a phone. The label is the only field a device has that anybody may
 * change — everything else about it is a fact the device itself reports.
 */
import type { DeviceAdmin } from '#shared/types'

const props = defineProps<{
  open: boolean
  device: DeviceAdmin | null
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{ close: [], save: [label: string] }>()

const label = ref('')

watch(() => [props.open, props.device?.id], () => {
  if (props.open) label.value = props.device?.label ?? ''
}, { immediate: true })
</script>

<template>
  <UiSheet
    :open="open"
    title="Preimenuj uređaj"
    :pending="pending"
    @close="emit('close')"
  >
    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
      <UiButton
        variant="primary"
        :pending="pending"
        :disabled="label.trim() === ''"
        @click="emit('save', label.trim())"
      >Sačuvaj</UiButton>
    </template>

    <p v-if="error" class="p-error" role="alert">{{ error }}</p>
    <UiField v-model="label" label="Naziv uređaja" placeholder="Amarov telefon" />
  </UiSheet>
</template>

<style scoped>
.p-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
}
</style>
