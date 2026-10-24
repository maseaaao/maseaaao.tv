import { withGlobal } from '@sinonjs/fake-timers';

const fakeTimers = withGlobal(window);
let clock: ReturnType<typeof fakeTimers.install> | undefined;

// Bun's timers lack async advancement; tickAsync also drains Promise callbacks
// between deadlines, preserving the debounce and request-timeout contracts.
export const timers = {
  useFake(): void {
    clock ??= fakeTimers.install({
      now: Date.now(),
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  },
  useReal(): void {
    clock?.uninstall();
    clock = undefined;
  },
  isFake(): boolean {
    return clock !== undefined;
  },
  async advance(milliseconds: number): Promise<void> {
    if (!clock) throw new Error('Fake timers are not installed');
    await clock.tickAsync(milliseconds);
  },
  count(): number {
    if (!clock) throw new Error('Fake timers are not installed');
    return clock.countTimers();
  },
  clear(): void {
    clock?.reset();
  },
};
