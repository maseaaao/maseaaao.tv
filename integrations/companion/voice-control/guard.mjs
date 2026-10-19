// One physical hold can dispatch at most one action. OBS remains authoritative.
export class StreamGuard {
  constructor({ read, dispatch, update, startMs = 3000, stopMs = 2000 }) {
    Object.assign(this, { read, dispatch, update, startMs, stopMs });
    this.online = false;
    this.active = false;
    this.busy = false;
    this.held = false;
  }
  status(active, transitioning = false) {
    this.online = true;
    this.active = active;
    if (transitioning) {
      this.busy = true;
      this.cancel();
    } else if (this.target === undefined || this.target === active) {
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
    if (this.held || this.busy || !this.online) return;
    this.held = true;
    const active = this.active;
    this.holdStart = Date.now();
    this.holdMs = active ? this.stopMs : this.startMs;
    const generation = (this.generation = (this.generation || 0) + 1);
    this.timer = setTimeout(
      async () => {
        if (!this.held || this.busy || !this.online) return;
        try {
          const current = await this.read();
          if (
            !this.held ||
            generation !== this.generation ||
            !this.online ||
            current !== active ||
            this.busy
          )
            return;
          this.busy = true;
          this.target = !active;
          this.update();
          // An uncertain HTTP result must never be retried automatically.
          this.timeout = setTimeout(() => {
            this.busy = false;
            this.target = undefined;
            this.update();
          }, 45000);
          await this.dispatch(active ? 'STATE | STOP' : 'STATE | START');
        } catch {
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
    this.generation = (this.generation || 0) + 1;
  }
  destroy() {
    this.cancel();
    clearTimeout(this.timeout);
    this.busy = false;
    this.target = undefined;
  }
}
