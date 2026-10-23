<template>
  <div class="brand-surface"><slot /></div>
</template>
<!-- biome-ignore lint/suspicious/useScopedStyles: This shared global surface is also consumed by the standalone artwork templates. -->
<style>
.brand-surface {
  background: var(--color-surface);
  border-radius: var(--radius-surface);
}
</style>
