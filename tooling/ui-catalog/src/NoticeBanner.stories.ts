import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within } from 'storybook/test';
import NoticeBanner from 'change-info-streamer-bot/NoticeBanner.vue';

const meta: Meta<typeof NoticeBanner> = {
  title: 'Stream Info/NoticeBanner',
  component: NoticeBanner,
  args: { title: 'Есть несохранённые изменения' },
};
export default meta;
type Story = StoryObj<typeof NoticeBanner>;

export const Info: Story = {};

export const Warning: Story = {
  args: { variant: 'warning' },
};

export const ErrorState: Story = {
  args: { variant: 'error', title: 'Не удалось сохранить изменения' },
  render: (args) => ({
    components: { NoticeBanner },
    setup() {
      return { args };
    },
    template:
      '<NoticeBanner v-bind="args">Проверьте подключение к Streamer.bot и повторите.</NoticeBanner>',
  }),
};

export const Success: Story = {
  args: { variant: 'success', title: 'Изменения сохранены' },
};

export const Dismissible: Story = {
  args: { variant: 'warning', dismissible: true },
};

export const LongRussianText: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: {
    variant: 'error',
    title: 'Не удалось подключиться к Streamer.bot на 127.0.0.1:8080',
    dismissible: true,
  },
  render: (args) => ({
    components: { NoticeBanner },
    setup() {
      return { args };
    },
    template:
      '<div style="max-width: 320px"><NoticeBanner v-bind="args">Проверьте, что Streamer.bot запущен и пароль указан верно, затем повторите попытку подключения.</NoticeBanner></div>',
  }),
};

export const Interaction: Story = {
  args: { dismissible: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dismiss = canvas.getByRole('button');
    await userEvent.click(dismiss);
    await expect(dismiss).toHaveFocus();
  },
};
