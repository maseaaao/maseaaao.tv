import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within } from 'storybook/test';
import ChipTag from './ChipTag.vue';

const meta: Meta<typeof ChipTag> = {
  title: 'Компоненты/ChipTag',
  component: ChipTag,
  args: { label: 'Русский' },
};
export default meta;
type Story = StoryObj<typeof ChipTag>;

export const Default: Story = {};

export const Removable: Story = {
  args: { removable: true },
};

export const LongRussianText: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: { label: 'Очень длинный тег для проверки переноса в узком контейнере', removable: true },
};

export const Interaction: Story = {
  args: { removable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');
    await userEvent.click(button);
    await expect(button).toHaveFocus();
  },
};
