import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export interface HelperChild extends EventEmitter {
  kill: () => unknown;
  stderr: Readable;
  stdin: Writable;
  stdout: Readable;
}
interface HelperOptions {
  args?: string[];
  file: string;
  onLine: (line: string) => unknown;
  onOffline: (message: string) => unknown;
  retry?: number;
  spawnProcess?: (file: string, args: string[], options: SpawnOptionsWithoutStdio) => HelperChild;
  timeout?: number;
}

// Owns only its own child. A failed or timed-out command is never replayed.
export class HelperProcess {
  declare file: string;
  declare args: string[];
  declare timeout: number;
  declare retry: number;
  declare onLine: HelperOptions['onLine'];
  declare onOffline: HelperOptions['onOffline'];
  declare spawnProcess: NonNullable<HelperOptions['spawnProcess']>;
  child: HelperChild | null = null;
  finish: ((message: string) => void) | null = null;
  lastSeen = 0;
  retryTimer: ReturnType<typeof setTimeout> | null = null;
  stopped: boolean;
  failures: number;
  constructor({
    file,
    args = [],
    timeout = 12_000,
    retry = 3000,
    onLine,
    onOffline,
    spawnProcess = spawn,
  }: HelperOptions) {
    Object.assign(this, { args, file, onLine, onOffline, retry, spawnProcess, timeout });
    this.stopped = true;
    this.failures = 0;
  }
  start() {
    this.stop();
    this.stopped = false;
    this.open();
  }
  open() {
    if (this.stopped) {
      return;
    }
    let child: HelperChild;
    try {
      child = this.spawnProcess(this.file, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      this.onOffline('Audio helper could not start');
      this.schedule();
      return;
    }
    this.child = child;
    this.lastSeen = Date.now();
    let done = false;
    const lines = readline.createInterface({ input: child.stdout });
    const finish = (message: string) => {
      if (done) {
        return;
      }
      done = true;
      lines.close();
      clearInterval(watchdog);
      if (this.child !== child) {
        return;
      }
      this.child = null;
      this.finish = null;
      try {
        child.stdin.end();
        child.kill();
      } catch {
        /* Best-effort cleanup or optional observation. */
      }
      this.onOffline(message);
      if (!this.stopped) {
        this.schedule();
      }
    };
    this.finish = finish;
    const watchdog = setInterval(
      () => {
        if (Date.now() - this.lastSeen >= this.timeout) {
          finish('Audio helper is not responding');
        }
      },
      Math.min(1000, this.timeout),
    );
    child.stdin.on('error', () => finish('Audio helper input failed'));
    child.stderr.on('data', () => {
      /* Поток stderr HelperProcess не используется: пустой обработчик нужен как подписка. */
    });
    let partialBytes = 0;
    child.stdout.on('data', (data) => {
      if (done) {
        return;
      }
      const bytes = Buffer.from(data);
      const newline = bytes.lastIndexOf(10);
      partialBytes = newline < 0 ? partialBytes + bytes.length : bytes.length - newline - 1;
      if (partialBytes > 65_536) {
        finish('Audio helper output limit');
      }
    });
    lines.on('line', (line) => {
      if (done || this.child !== child) {
        return;
      }
      try {
        if (line.length > 65_536) {
          throw new Error('status size');
        }
        this.onLine(line);
        this.lastSeen = Date.now();
        this.failures = 0;
      } catch {
        finish('Invalid audio helper status');
      }
    });
    child.once('error', () => finish('Audio helper could not start'));
    child.once('close', () => finish('Audio helper stopped'));
  }
  schedule() {
    if (this.stopped || this.retryTimer) {
      return;
    }
    const delay = Math.min(30_000, this.retry * 2 ** Math.min(this.failures, 4));
    this.failures += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }
  send(line: string) {
    if (this.stopped || !this.child || Date.now() - this.lastSeen >= this.timeout) {
      return false;
    }
    try {
      this.child.stdin.write(line + '\n');
      return true;
    } catch {
      this.finish?.('Audio helper input failed');
      return false;
    }
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer ?? undefined);
    this.retryTimer = null;
    this.finish?.('Audio helper stopped');
    this.finish = null;
  }
}
