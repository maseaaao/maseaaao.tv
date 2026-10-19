import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ref } from 'vue';
import AppButton from '@maseaaao/ui/AppButton.vue';
import ChipTag from 'change-info-streamer-bot/ChipTag.vue';
import IconIndicator from '@maseaaao/ui/IconIndicator.vue';
import NoticeBanner from 'change-info-streamer-bot/NoticeBanner.vue';

const meta: Meta = { title: 'Композиции/Контракты элементов дока' };
export default meta;
type Story = StoryObj;
export const Controls: Story = {
  render: () => ({
    components: { AppButton, ChipTag, IconIndicator, NoticeBanner },
    setup() {
      const count = ref(0);
      const loading = ref(false);
      return { count, loading };
    },
    template: `<section aria-label="Элементы дока">
      <div style="background: var(--color-brand); padding: 16px">
        <IconIndicator inverted status="connected" label="Подключено" />
        <AppButton inverted press-effect @click="count++">Обновить</AppButton>
      </div>
      <AppButton as="a" href="#fixture-target" :loading="loading" @click="count++">Перейти</AppButton>
      <button type="button" @click="loading = !loading">Загрузка</button>
      <ChipTag label="Русский" removable variant="accent" @remove="count++" />
      <NoticeBanner variant="error" title="Ошибка записи" dismissible @dismiss="count++">
        <template #icon><svg viewBox="0 0 24 24" width="24" height="24"><path d="M2 2L22 22M22 2L2 22" stroke="currentColor" /></svg></template>
        Повторите попытку.
      </NoticeBanner>
      <output aria-label="Действия">{{ count }}</output>
    </section>`,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const notice = canvas.getByRole('alert');
    await expect(notice).toHaveTextContent('Ошибка записи');
    await expect(notice.querySelector('svg')).not.toBeNull();
    const remove = canvas.getByRole('button', { name: 'Удалить: Русский' });
    await expect(remove.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(remove);
    await expect(canvas.getByRole('status', { name: 'Действия' })).toHaveTextContent('1');
    await userEvent.click(canvas.getByRole('button', { name: 'Загрузка' }));
    const link = canvas.getByText('Перейти').closest('a');
    await expect(link).not.toHaveAttribute('href');
    await userEvent.click(canvas.getByRole('button', { name: 'Скрыть' }));
    await expect(canvas.getByRole('status', { name: 'Действия' })).toHaveTextContent('2');
  },
};
