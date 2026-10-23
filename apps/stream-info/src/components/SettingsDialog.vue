<script setup lang="ts">
import AppButton from '@maseaaao/ui/AppButton.vue';
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { t } from '../messages';
import AppIcon from './AppIcon.vue';

const emit = defineEmits<{ close: [] }>();
const id = useId();
const dialog = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;
function keydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
  if (event.key !== 'Tab') return;
  const fields = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    ) ?? [],
  );
  const active = document.activeElement;
  const index = active instanceof HTMLElement ? fields.indexOf(active) : -1;
  if (
    fields.length &&
    (index < 0 ||
      (!event.shiftKey && index === fields.length - 1) ||
      (event.shiftKey && index === 0))
  ) {
    event.preventDefault();
    fields[event.shiftKey ? fields.length - 1 : 0]?.focus();
  }
}
onMounted(() => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.querySelector<HTMLElement>('button, input, textarea')?.focus();
});
onBeforeUnmount(() => {
  const target = returnFocus;
  void nextTick(() => {
    if (target?.isConnected) target.focus();
  });
});
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')" @keydown="keydown"
    ><section
      ref="dialog"
      class="modal settings-modal"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${id}-title`"
      ><header class="modal-header"
        ><div
          ><span class="eyebrow">{{ t('connection') }}</span
          ><h2 :id="`${id}-title`">{{ t('settings') }}</h2></div
        ><AppButton variant="icon" :aria-label="t('close')" @click="emit('close')"
          ><template #icon><AppIcon name="close" /></template></AppButton
        ></header
      ><div class="modal-body"><slot /></div
      ><footer class="modal-footer"><slot name="footer" /></footer></section
    ></div
  >
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: color-mix(in srgb, var(--color-text) 40%, transparent);
}
.settings-modal {
  width: min(100%, 520px);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-surface);
  background: var(--color-surface);
  box-shadow: 0 12px 60px color-mix(in srgb, var(--color-text) 20%, transparent);
}
.settings-enter-active,
.settings-leave-active {
  transition: opacity var(--motion-enter) var(--motion-ease-enter);
}
.settings-enter-active .settings-modal,
.settings-leave-active .settings-modal {
  transition:
    transform var(--motion-enter) var(--motion-ease-spring),
    filter var(--motion-focus) ease-out;
  transform-origin: 50% 40%;
}
.settings-leave-active,
.settings-leave-active .settings-modal {
  transition-duration: var(--motion-exit), var(--motion-focus);
  transition-timing-function: var(--motion-ease-exit);
  pointer-events: none;
}
.settings-enter-from,
.settings-leave-to {
  opacity: 0;
}
.settings-enter-from .settings-modal {
  transform: translateY(10px) scale(0.975);
  filter: blur(2px);
}
.settings-leave-to .settings-modal {
  transform: translateY(4px) scale(0.985);
  filter: blur(1px);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-5);
}
h2 {
  margin-top: var(--space-1);
  font-size: 23px;
}
.eyebrow {
  font-size: 12px;
  color: var(--color-muted);
}
.modal-body {
  overflow-y: auto;
  padding: 0 var(--space-5) var(--space-5);
}
.modal-footer {
  display: grid;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--color-border);
}

@media (width < 390px) {
  .modal-backdrop {
    padding: var(--space-2);
  }
  .modal-header,
  .modal-body,
  .modal-footer {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }
}
</style>
