import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import AppButton from '@maseaaao/ui/AppButton.vue';
import ChipTag from '@maseaaao/ui/ChipTag.vue';

const styles = readFileSync(resolve('src/styles.css'), 'utf8');
const tokens = readFileSync(resolve('../../packages/design/tokens.css'), 'utf8');
// Vitest does not inject SFC styles and jsdom cannot resolve custom properties.
// Load the actual shared component style blocks, then resolve the one size token
// when measuring. No test-only control sizing rules are introduced here.
const componentStyles = ['AppButton', 'ChipTag']
  .map((name) => {
    const source = readFileSync(resolve(`../../packages/ui/src/${name}.vue`), 'utf8');
    return source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';
  })
  .join('\n');
const wrappers: VueWrapper[] = [];
let sheet: HTMLStyleElement | undefined;

function pixels(value: string): number {
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_match, token: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
  );
  // jsdom omits the UA initial font size; browsers use 16px when unset.
  if (resolved.endsWith('rem'))
    return (
      Number.parseFloat(resolved) *
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '16px')
    );
  if (resolved.endsWith('px')) return Number.parseFloat(resolved);
  throw new Error(`Unsupported control size: ${value} (${resolved})`);
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sheet?.remove();
  sheet = undefined;
  document.body.replaceChildren();
});

describe('Portable dock controls', () => {
  it('retains touch targets and a system body font', () => {
    sheet = document.createElement('style');
    sheet.textContent = tokens + '\n' + styles + '\n' + componentStyles;
    document.head.append(sheet);
    const apply = mount(AppButton, {
      attachTo: document.body,
      props: { variant: 'primary' },
      slots: { default: 'Применить изменения' },
    });
    const settings = mount(AppButton, {
      attachTo: document.body,
      props: { variant: 'icon', ariaLabel: 'Настройки' },
    });
    const chip = mount(ChipTag, {
      attachTo: document.body,
      props: { label: 'PUBG', removable: true, removeLabel: 'Удалить тег' },
    });
    wrappers.push(apply, settings, chip);

    expect(getComputedStyle(document.documentElement).fontFamily).toContain('Arial');
    expect(pixels(getComputedStyle(apply.get('button').element).minHeight)).toBe(44);
    expect(
      pixels(getComputedStyle(settings.get('button[aria-label="Настройки"]').element).minWidth),
    ).toBe(44);
    expect(
      pixels(getComputedStyle(chip.get('button[aria-label="Удалить тег: PUBG"]').element).height),
    ).toBe(44);
  });
});
