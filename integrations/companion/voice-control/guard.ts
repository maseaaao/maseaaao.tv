// One physical hold can dispatch at most one action. OBS remains authoritative.
interface GuardOptions {
  dispatch: (name: 'STATE | START' | 'STATE | STOP') => Promise<unknown>;
  read: () => Promise<boolean>;
  startMs?: number;
  stopMs?: number;
  update: () => void;
}
export class StreamGuard {
  declare read: GuardOptions['read'];
  declare dispatch: GuardOptions['dispatch'];
  declare update: GuardOptions['update'];
  declare startMs: number;
  declare stopMs: number;
  target: boolean | undefined;
  timeout: ReturnType<typeof setTimeout> | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  generation = 0;
  operation = 0;
  holdStart = 0;
  holdMs = 0;
  online: boolean;
  active: boolean;
  busy: boolean;
  held: boolean;
  constructor({ read, dispatch, update, startMs = 3000, stopMs = 2000 }: GuardOptions) {
    Object.assign(this, { dispatch, read, startMs, stopMs, update });
    this.online = false;
    this.active = false;
    this.busy = false;
    this.held = false;
  }
  status(active: boolean, transitioning = false) {
    this.online = true;
    this.active = active;
    if (transitioning) {
      this.busy = true;
      this.cancel();
    } else if (this.target === undefined || this.target === active) {
      this.operation += 1;
      this.busy = false;
      this.target = undefined;
      clearTimeout(this.timeout);
    }
    this.update();
  }
  offline() {
    this.online = false;
    this.cancel();
    this.update();
  }
  down() {
    if (this.held || this.busy || !this.online) {
      return;
    }
    this.held = true;
    const { active } = this;
    this.holdStart = Date.now();
    this.holdMs = active ? this.stopMs : this.startMs;
    this.generation += 1;
    const { generation } = this;
    this.timer = setTimeout(
      async () => {
        if (!this.held || this.busy || !this.online) {
          return;
        }
        let { operation } = this;
        let dispatched = false;
        try {
          const current = await this.read();
          if (
            !this.held ||
            generation !== this.generation ||
            !this.online ||
            current !== active ||
            this.busy
          ) {
            return;
          }
          this.operation += 1;
          ({ operation } = this);
          dispatched = true;
          this.busy = true;
          this.target = !active;
          this.update();
          // An uncertain HTTP result must never be retried automatically.
          this.timeout = setTimeout(() => {
            if (operation !== this.operation) {
              return;
            }
            this.operation += 1;
            this.busy = false;
            this.target = undefined;
            this.update();
          }, 45_000);
          await this.dispatch(active ? 'STATE | STOP' : 'STATE | START');
        } catch {
          if (dispatched ? operation !== this.operation : generation !== this.generation) {
            return;
          }
          this.operation += 1;
          this.busy = false;
          this.target = undefined;
          clearTimeout(this.timeout);
          this.update();
        }
      },
      active ? this.stopMs : this.startMs,
    );
    this.update();
  }
  up() {
    this.cancel();
    this.update();
  }
  cancel() {
    clearTimeout(this.timer);
    this.held = false;
    this.generation += 1;
  }
  destroy() {
    this.operation += 1;
    this.cancel();
    clearTimeout(this.timeout);
    this.busy = false;
    this.target = undefined;
  }
}
