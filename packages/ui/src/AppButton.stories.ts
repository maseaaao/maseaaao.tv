import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within } from 'storybook/test';
import AppButton from './AppButton.vue';

const meta: Meta<typeof AppButton> = {
  title: 'Компоненты/AppButton',
  component: AppButton,
  args: { variant: 'secondary' },
};
export default meta;
type Story = StoryObj<typeof AppButton>;

export const Primary: Story = {
  args: { variant: 'primary' },
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template: '<AppButton v-bind="args">Применить изменения</AppButton>',
  }),
};

export const Secondary: Story = {
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template: '<AppButton v-bind="args">Отмена</AppButton>',
  }),
};

export const Icon: Story = {
  args: { variant: 'icon', ariaLabel: 'Настройки' },
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template: '<AppButton v-bind="args"><template #icon>⚙</template></AppButton>',
  }),
};

export const AsLink: Story = {
  args: {
    as: 'a',
    href: 'https://www.twitch.tv/maseaaao',
    target: '_blank',
    rel: 'noopener noreferrer',
  },
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template: '<AppButton v-bind="args">Открыть на Twitch</AppButton>',
  }),
};

export const Loading: Story = {
  args: { variant: 'primary', loading: true },
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template: '<AppButton v-bind="args">Сохранение…</AppButton>',
  }),
};

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template: '<AppButton v-bind="args">Недоступно</AppButton>',
  }),
};

export const LongRussianText: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template:
      '<div style="max-width: 200px"><AppButton v-bind="args">Применить все изменения шаблона заголовка трансляции</AppButton></div>',
  }),
};

export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');
    button.focus();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
  },
  render: (args) => ({
    components: { AppButton },
    setup() {
      return { args };
    },
    template: '<AppButton v-bind="args">Действие</AppButton>',
  }),
};
