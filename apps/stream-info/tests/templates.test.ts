import { describe, expect, it } from 'bun:test';
import { titleFromTemplate } from '../src/templates';

describe('stream title templates', () => {
  it('substitutes the Twitch game and the shared subtitle', () => {
    expect(titleFromTemplate('🔴 $g | $s', 'Рейтинг', 'PUBG: BATTLEGROUNDS')).toBe(
      '🔴 PUBG: BATTLEGROUNDS | Рейтинг',
    );
  });

  it('keeps the title readable when the Twitch game is not selected', () => {
    expect(titleFromTemplate('🔴 $g | $s', 'Рейтинг', '')).toBe('🔴 | Рейтинг');
    expect(titleFromTemplate('🔴 $g|$s', 'Рейтинг', '')).toBe('🔴 |Рейтинг');
  });

  it('replaces every occurrence without treating $ in the value as a token', () => {
    expect(titleFromTemplate('$g / $g / $s', '$s', 'Игра $g')).toBe('Игра $g / Игра $g / $s');
  });
});
