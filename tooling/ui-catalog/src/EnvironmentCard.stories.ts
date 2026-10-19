import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within } from 'storybook/test';
import EnvironmentCard from './EnvironmentCard.vue';

const meta: Meta<typeof EnvironmentCard> = {
  title: 'Окружение/Проверка сборки',
  component: EnvironmentCard,
};
export default meta;
type Story = StoryObj<typeof EnvironmentCard>;
export const Interaction: Story = {
  args: { title: 'Проверка интерфейса' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Изменить значение' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('status')).toHaveTextContent('Значение: 1');
    await expect(button).toHaveFocus();
  },
};
export const LongText: Story = {
  args: { title: 'Очень длинное русское название для проверки переноса в компактном контейнере' },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
