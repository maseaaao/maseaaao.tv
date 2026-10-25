import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CompanionFeedbackDefinitions,
  type CompanionPresetDefinitions,
  type CompanionStaticUpgradeScript,
  type CompanionVariableValues,
  InstanceBase,
  InstanceStatus,
  type JsonObject,
  type SomeCompanionConfigField,
} from '@companion-module/base';
import { HelperProcess } from '../shared/helper-process.ts';
import { StreamGuard } from './guard.ts';

const CLIENT_KEYWORD_RE = /client/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keys = ['discord', 'steam'] as const;
const BLUE = 26_367,
  RED = 13_840_175,
  PURPLE = 9_323_693,
  YELLOW = 16_766_011,
  GRAY = 4_473_924;
const mix = (a: number, b: number, t: number) => {
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (
    // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
    (c((a >> 16) & 255, (b >> 16) & 255) << 16) |
    // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
    (c((a >> 8) & 255, (b >> 8) & 255) << 8) |
    // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
    c(a & 255, b & 255)
  );
};
export interface VoiceConfig {
  discordClientId?: string;
  discordDeafenKey?: string;
  discordMicKey?: string;
  obsHost?: string;
  obsPassword?: string;
  obsPort?: number;
  startActionId?: string;
  steamMicKey?: string;
  stopActionId?: string;
  streamerbotUrl?: string;
}
interface AudioSession {
  available?: boolean;
  mixed?: boolean;
  muted?: boolean;
}
type AudioState = Partial<Record<'discord' | 'steam', AudioSession>>;
interface AudioReply extends AudioState {
  commandError?: string;
  error?: string;
}
interface DiscordState {
  connected: boolean;
  deaf?: boolean | null;
  mute?: boolean | null;
}
export interface StreamStatus {
  outputActive: boolean;
  outputReconnecting?: boolean;
}
interface PendingRequest {
  reject: (reason: unknown) => void;
  resolve: (status: StreamStatus) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface ObsMessage {
  d: {
    authentication?: { salt: string; challenge: string };
    requestId: string;
    requestStatus: { result: boolean };
    responseData: StreamStatus;
    eventType: string;
    eventData: StreamStatus & { outputState: string };
  };
  op: number;
}
interface DiscordMessage {
  cmd?: string;
  data?: { mute?: boolean; deaf?: boolean; message?: string };
  evt?: string;
}
export default class VoiceStream extends InstanceBase {
  declare config: VoiceConfig;
  declare audio: AudioState;
  declare pending: Map<string, PendingRequest>;
  declare counter: number;
  declare guard: StreamGuard;
  declare stopped: boolean;
  declare identified: boolean;
  declare discordRejected: boolean;
  declare audioHealthy: boolean;
  declare audioSeen: number;
  declare lastPublished: string;
  declare discord: DiscordState;
  helper: HelperProcess | null = null;
  ws: WebSocket | null = null;
  discordSock: net.Socket | null = null;
  monitor: ReturnType<typeof setInterval> | undefined;
  holdTick: ReturnType<typeof setInterval> | null = null;
  audioRetry: ReturnType<typeof setTimeout> | undefined;
  obsRetry: ReturnType<typeof setTimeout> | undefined;
  discordRetry: ReturnType<typeof setTimeout> | undefined;
  handshake: ReturnType<typeof setTimeout> | undefined;
  async init(config: VoiceConfig) {
    this.audio = {};
    this.pending = new Map();
    this.counter = 0;
    this.setVariableDefinitions({
      discord_mic_label: { name: 'Подпись кнопки микрофона Discord' },
      discord_state: { name: 'Звук Discord выключен' },
      discord_team_label: { name: 'Подпись кнопки собеседников Discord' },
      steam_state: { name: 'Звук Steam выключен' },
      stream_active: { name: 'Эфир OBS' },
      stream_available: { name: 'Соединение OBS' },
      stream_label: { name: 'Подпись кнопки эфира' },
    });
    this.guard = new StreamGuard({
      dispatch: async (name) => {
        const r = await fetch(
          new URL('/DoAction', this.config.streamerbotUrl || 'http://127.0.0.1:7474'),
          {
            body: JSON.stringify({
              action: {
                id: this.config[name === 'STATE | START' ? 'startActionId' : 'stopActionId'],
              },
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!r.ok) {
          throw new Error('Streamer.bot action failed');
        }
      },
      read: async () => {
        const s = await this.request('GetStreamStatus');
        return s.outputActive;
      },
      update: () => this.publish(),
    });
    this.setActionDefinitions({
      discord_deafen: {
        callback: () => this.mic(this.config.discordDeafenKey),
        name: 'Клавиша звука собеседников Discord',
        options: [],
      },
      discord_mic: {
        callback: () => this.mic(this.config.discordMicKey),
        name: 'Клавиша микрофона Discord',
        options: [],
      },
      discord_toggle: {
        callback: () => this.toggle('discord'),
        name: 'Переключить звук Discord',
        options: [],
      },
      heal: {
        callback: () => {
          this.restart();
          this.log('info', 'Manual heal: sockets and helper restarted');
        },
        name: 'Переподключить модуль и аудиопомощник',
        options: [],
      },
      steam_mic: {
        callback: () => this.mic(this.config.steamMicKey),
        name: 'Клавиша микрофона Steam',
        options: [],
      },
      steam_toggle: {
        callback: () => this.toggle('steam'),
        name: 'Переключить звук Steam',
        options: [],
      },
      stream_down: {
        callback: () => this.guard.down(),
        name: 'Начать удержание кнопки эфира',
        options: [],
      },
      stream_up: { callback: () => this.guard.up(), name: 'Отпустить кнопку эфира', options: [] },
    });
    const feedbacks: CompanionFeedbackDefinitions = {};
    for (const key of keys) {
      feedbacks[key + '_muted'] = {
        callback: () => !!this.audio[key]?.muted,
        defaultStyle: { bgcolor: 11_739_175 },
        name: (key === 'discord' ? 'Discord' : 'Steam') + ': звук выключен',
        options: [],
        type: 'boolean',
      };
      feedbacks[key + '_unavailable'] = {
        callback: () => !this.audio[key]?.available,
        defaultStyle: { bgcolor: 4_473_924 },
        name: (key === 'discord' ? 'Discord' : 'Steam') + ': аудиосессия недоступна',
        options: [],
        type: 'boolean',
      };
    }
    feedbacks.stream_bg = {
      affectedProperties: ['bgcolor'],
      callback: () => ({ bgcolor: this.streamStyle().bg }),
      name: 'Фон кнопки эфира',
      options: [],
      type: 'advanced',
    };
    feedbacks.discord_mic_bg = {
      affectedProperties: ['bgcolor'],
      callback: () => ({
        bgcolor:
          // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
          this.discord?.connected && (this.discord.mute === true || this.discord.deaf === true)
            ? YELLOW
            : PURPLE,
      }),
      name: 'Фон кнопки микрофона Discord',
      options: [],
      type: 'advanced',
    };
    feedbacks.discord_team_bg = {
      affectedProperties: ['bgcolor'],
      callback: () => ({
        // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
        bgcolor: this.discord?.connected && this.discord.deaf === true ? YELLOW : PURPLE,
      }),
      name: 'Фон кнопки собеседников Discord',
      options: [],
      type: 'advanced',
    };
    this.setFeedbackDefinitions(feedbacks);
    const presets: CompanionPresetDefinitions = {};
    for (const key of keys) {
      presets[key] = {
        feedbacks: [
          { feedbackId: key + '_muted', options: {}, style: { bgcolor: 11_739_175 } },
          { feedbackId: key + '_unavailable', options: {}, style: { bgcolor: 4_473_924 } },
        ],
        name: 'Звук ' + (key === 'discord' ? 'Discord' : 'Steam'),
        steps: [{ down: [{ actionId: key + '_toggle', options: {} }], up: [] }],
        style: {
          bgcolor: 1_793_104,
          color: 16_777_215,
          size: 18,
          text: `${key === 'discord' ? 'Discord' : 'Steam'}\n$(local-voice-stream:${key}_state)`,
        },
        type: 'simple',
      };
    }
    presets.stream = {
      feedbacks: [{ feedbackId: 'stream_bg', options: {} }],
      name: 'Эфир: удерживать 3 с для старта / 2 с для остановки',
      steps: [
        {
          down: [{ actionId: 'stream_down', options: {} }],
          up: [{ actionId: 'stream_up', options: {} }],
        },
      ],
      style: {
        bgcolor: BLUE,
        color: 16_777_215,
        size: 20,
        text: '$(local-voice-stream:stream_label)',
      },
      type: 'simple',
    };
    presets.discord_mic = {
      feedbacks: [{ feedbackId: 'discord_mic_bg', options: {} }],
      name: 'Микрофон Discord',
      steps: [{ down: [{ actionId: 'discord_mic', options: {} }], up: [] }],
      style: {
        bgcolor: PURPLE,
        color: 16_777_215,
        size: 14,
        text: '$(local-voice-stream:discord_mic_label)',
      },
      type: 'simple',
    };
    presets.discord_deafen = {
      feedbacks: [{ feedbackId: 'discord_team_bg', options: {} }],
      name: 'Звук собеседников Discord',
      steps: [{ down: [{ actionId: 'discord_deafen', options: {} }], up: [] }],
      style: {
        bgcolor: PURPLE,
        color: 16_777_215,
        size: 14,
        text: '$(local-voice-stream:discord_team_label)',
      },
      type: 'simple',
    };
    presets.steam_mic = {
      feedbacks: [],
      name: 'Клавиша микрофона Steam',
      steps: [{ down: [{ actionId: 'steam_mic', options: {} }], up: [] }],
      style: { bgcolor: 1_793_104, color: 16_777_215, size: 18, text: 'Steam\n🎙️' },
      type: 'simple',
    };
    presets.heal = {
      feedbacks: [],
      name: 'Переподключить модуль',
      steps: [{ down: [{ actionId: 'heal', options: {} }], up: [] }],
      style: { bgcolor: 1_793_104, color: 16_777_215, size: 18, text: 'СБРОС\n🩹' },
      type: 'simple',
    };
    this.setPresetDefinitions(
      [{ definitions: Object.keys(presets), id: 'voice', name: 'Звук и эфир' }],
      presets,
    );
    await this.configUpdated(config);
  }
  getConfigFields(): (SomeCompanionConfigField & {
    isVisible?: () => boolean;
    useAsPassword?: boolean;
  })[] {
    const keyChoices: { id: string; label: string }[] = [];
    for (let i = 1; i <= 24; i += 1) {
      keyChoices.push({ id: 'F' + i, label: 'F' + i });
    }
    keyChoices.push(
      { id: 'End', label: 'End' },
      { id: 'Home', label: 'Home' },
      { id: 'PgUp', label: 'PgUp' },
      { id: 'PgDn', label: 'PgDn' },
      { id: 'Ins', label: 'Insert' },
      { id: 'Del', label: 'Delete' },
      { id: 'ScrollLock', label: 'Scroll Lock' },
      { id: 'Pause', label: 'Pause' },
    );
    return [
      {
        default: 'http://127.0.0.1:7474',
        id: 'streamerbotUrl',
        label: 'HTTP-адрес Streamer.bot',
        type: 'textinput',
        width: 12,
      },
      {
        default: '',
        id: 'startActionId',
        label: 'ID Action запуска эфира',
        type: 'textinput',
        width: 6,
      },
      {
        default: '',
        id: 'stopActionId',
        label: 'ID Action остановки эфира',
        type: 'textinput',
        width: 6,
      },
      { default: '127.0.0.1', id: 'obsHost', label: 'Адрес OBS', type: 'textinput', width: 8 },
      {
        default: 4455,
        id: 'obsPort',
        label: 'Порт OBS',
        max: 65_535,
        min: 1,
        type: 'number',
        width: 4,
      },
      {
        default: '',
        id: 'obsPassword',
        isVisible: () => true,
        label: 'Пароль WebSocket OBS',
        type: 'textinput',
        useAsPassword: true,
        width: 12,
      },
      {
        choices: keyChoices,
        default: 'F13',
        id: 'discordMicKey',
        label: 'Клавиша микрофона Discord',
        type: 'dropdown',
        width: 4,
      },
      {
        choices: keyChoices,
        default: 'F14',
        id: 'discordDeafenKey',
        label: 'Клавиша звука собеседников Discord',
        type: 'dropdown',
        width: 4,
      },
      {
        default: '1161350695322591324',
        id: 'discordClientId',
        label: 'ID локального RPC Discord',
        type: 'textinput',
        width: 6,
      },
      {
        choices: keyChoices,
        default: 'End',
        id: 'steamMicKey',
        label: 'Микрофон Steam',
        type: 'dropdown',
        width: 4,
      },
    ];
  }
  configUpdated(config: VoiceConfig) {
    this.config = config;
    this.restart();
    return Promise.resolve();
  }
  restart() {
    this.stop();
    const idPattern = UUID_RE;
    const { startActionId, stopActionId } = this.config || {};
    if (
      typeof startActionId !== 'string' ||
      typeof stopActionId !== 'string' ||
      !idPattern.test(startActionId) ||
      !idPattern.test(stopActionId) ||
      startActionId.toLowerCase() === stopActionId.toLowerCase()
    ) {
      this.updateStatus(
        InstanceStatus.BadConfig,
        'Укажите разные корректные ID Actions запуска и остановки',
      );
      return;
    }
    this.stopped = false;
    this.discordRejected = false;
    this.startAudio();
    this.connectObs();
    this.startDiscord();
    this.monitor = setInterval(() => {
      if (Date.now() - this.audioSeen > 12_000) {
        this.audio = {};
        this.publish();
      }
      // pollObs handles request failures and disconnects internally.
      this.pollObs().catch(() => undefined);
    }, 5000);
  }
  pollObs() {
    const { ws } = this;
    if (this.stopped || !this.identified || !ws) {
      return Promise.resolve();
    }
    return this.request('GetStreamStatus')
      .then((s) => {
        if (!this.stopped && this.ws === ws) {
          this.guard.status(s.outputActive, s.outputReconnecting);
        }
      })
      .catch(() => {
        if (this.stopped || this.ws !== ws) {
          return;
        }
        this.guard.offline();
        ws.close();
      });
  }
  streamStyle() {
    const g = this.guard;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
    if (!g) {
      return { bg: BLUE, label: '' };
    }
    if (!g.online) {
      return { bg: GRAY, label: '📡⚠️' };
    }
    if (g.busy) {
      return g.active ? { bg: RED, label: '🎥⏳' } : { bg: BLUE, label: '🚀⏳' };
    }
    if (g.held && g.holdStart) {
      const t = Math.min(1, (Date.now() - g.holdStart) / g.holdMs);
      const v = ((t * g.holdMs) / 1000).toFixed(1);
      return g.active
        ? { bg: mix(RED, BLUE, t), label: '🏁' + v }
        : { bg: mix(BLUE, RED, t), label: '🚀' + v };
    }
    return g.active ? { bg: RED, label: '🎥' } : { bg: BLUE, label: '🚀' };
  }
  publish() {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
    if (!this.guard) {
      return;
    }
    const g = this.guard;
    const st = this.streamStyle();
    const d = this.discord || { connected: false };
    const values: CompanionVariableValues = {
      discord_mic_label: d.connected
        ? 'Discord 🎙️' +
          (() => {
            if (d.mute === true || d.deaf === true) {
              return '❌';
            }
            if (d.mute === false) {
              return '🟢';
            }
            return '';
          })()
        : 'Discord 🎙️',
      discord_team_label: d.connected
        ? 'Discord 💬' +
          (() => {
            if (d.deaf === true) {
              return '❌';
            }
            if (d.deaf === false) {
              return '🟢';
            }
            return '';
          })()
        : 'Discord 💬',
      stream_active: g.active,
      stream_available: g.online,
      stream_label: st.label,
    };
    for (const key of keys) {
      const s = this.audio[key];
      values[key + '_state'] = (() => {
        if (s?.available) {
          if (s.mixed) {
            return '🔊/🔇';
          }
          if (s.muted) {
            return '🔇';
          }
          return '🔊';
        }
        return '⚠️';
      })();
    }
    const signature = JSON.stringify([values, st.bg, this.audio, d]);
    if (signature !== this.lastPublished) {
      this.lastPublished = signature;
      this.setVariableValues(values);
      this.checkFeedbacks(
        'stream_bg',
        'discord_mic_bg',
        'discord_team_bg',
        'discord_muted',
        'discord_unavailable',
        'steam_muted',
        'steam_unavailable',
      );
    }
    if (g.held && !this.holdTick) {
      this.holdTick = setInterval(() => {
        // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
        if (this.guard?.held) {
          this.publish();
        } else {
          clearInterval(this.holdTick ?? undefined);
          this.holdTick = null;
          this.publish();
        }
      }, 100);
    } else if (!g.held && this.holdTick) {
      clearInterval(this.holdTick ?? undefined);
      this.holdTick = null;
    }
    const audioReady =
      !!this.helper?.child && this.audioHealthy && Date.now() - this.audioSeen < 12_000;
    this.updateStatus(
      audioReady && g.online ? InstanceStatus.Ok : InstanceStatus.Connecting,
      (() => {
        if (g.online) {
          if (audioReady) {
            return 'Звук / состояние OBS';
          }
          return 'Аудиопомощник недоступен';
        }
        return 'Нет соединения с OBS';
      })(),
    );
  }
  startDiscord() {
    const clientId = String(this.config.discordClientId || '1161350695322591324');
    const open = (idx: number) => {
      if (this.stopped) {
        return;
      }
      this.discord = { connected: false, deaf: null, mute: null };
      let acc = Buffer.alloc(0);
      const sock = net.connect('\\\\.\\pipe\\discord-ipc-' + idx);
      this.discordSock = sock;
      sock.setTimeout(15_000, () => sock.destroy());
      const send = (op: number, o: unknown) => {
        const p = Buffer.from(JSON.stringify(o));
        const h = Buffer.alloc(8);
        h.writeUInt32LE(op, 0);
        h.writeUInt32LE(p.length, 4);
        try {
          sock.write(Buffer.concat([h, p]));
        } catch {
          /* Best-effort cleanup or optional observation. */
        }
      };
      sock.on('connect', () => {
        send(0, { client_id: clientId, v: 1 });
      });
      const updateDiscordVoice = (data: NonNullable<DiscordMessage['data']>) => {
        this.discord.connected = true;
        if (typeof data.mute === 'boolean') {
          this.discord.mute = data.mute;
        }
        if (typeof data.deaf === 'boolean') {
          this.discord.deaf = data.deaf;
        }
        this.publish();
      };
      const handleDiscordMessage = (payload: Buffer) => {
        try {
          const m: DiscordMessage = JSON.parse(payload.toString());
          if (m.cmd === 'DISPATCH' && m.evt === 'READY') {
            sock.setTimeout(0);
            this.discord.connected = true;
            this.discordRejected = false;
            send(1, { cmd: 'SUBSCRIBE', evt: 'VOICE_SETTINGS_UPDATE', nonce: 's1' });
            send(1, { args: {}, cmd: 'GET_VOICE_SETTINGS', nonce: 's2' });
          }
          if ((m.evt === 'VOICE_SETTINGS_UPDATE' || m.cmd === 'GET_VOICE_SETTINGS') && m.data) {
            updateDiscordVoice(m.data);
          }
          if (m.evt === 'ERROR' && m.data && CLIENT_KEYWORD_RE.test(m.data.message || '')) {
            this.discordRejected = true;
            this.log('warn', 'Discord RPC rejected client id');
          }
        } catch {
          /* Best-effort cleanup or optional observation. */
        }
      };
      const handleDiscordFrame = (op: number, len: number, payload: Buffer): boolean => {
        if (op === 3) {
          try {
            sock.write(
              Buffer.concat([
                Buffer.from([4, 0, 0, 0]),
                Buffer.from([
                  // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
                  len & 255,
                  // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
                  (len >>> 8) & 255,
                  // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
                  (len >>> 16) & 255,
                  // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
                  (len >>> 24) & 255,
                ]),
                payload,
              ]),
            );
          } catch {
            /* Best-effort cleanup or optional observation. */
          }
          return true;
        }
        if (op === 2) {
          sock.destroy();
          return false;
        }
        if (op !== 1) {
          return true;
        }
        handleDiscordMessage(payload);
        return true;
      };
      const drainDiscordFrames = () => {
        while (acc.length >= 8) {
          const op = acc.readUInt32LE(0),
            len = acc.readUInt32LE(4);
          if (len > 1_048_576) {
            sock.destroy();
            return;
          }
          if (acc.length < 8 + len) {
            break;
          }
          const payload = acc.slice(8, 8 + len);
          acc = acc.slice(8 + len);
          if (!handleDiscordFrame(op, len, payload)) {
            return;
          }
        }
      };
      sock.on('data', (d) => {
        if (this.discordSock !== sock || this.stopped) {
          return;
        }
        if (acc.length + d.length > 1_048_576) {
          sock.destroy();
          return;
        }
        acc = Buffer.concat([acc, typeof d === 'string' ? Buffer.from(d) : d]);
        drainDiscordFrames();
      });
      sock.on('error', () => {
        /* Хук alive-пульса: пустой обработчик нужен как подписка, ошибки не ждём. */
      });
      sock.on('close', () => {
        if (this.discordSock !== sock) {
          return;
        }
        this.discordSock = null;
        this.discord = { connected: false, deaf: null, mute: null };
        this.publish();
        if (this.stopped) {
          return;
        }
        if (this.discordRejected) {
          this.discordRetry = setTimeout(() => open(0), 30_000);
          return;
        }
        if (idx < 9) {
          this.discordRetry = setTimeout(() => open(idx + 1), 1000);
        } else {
          this.discordRetry = setTimeout(() => open(0), 5000);
        }
      });
    };
    open(0);
  }
  startAudio() {
    this.audio = {};
    this.audioHealthy = false;
    this.audioSeen = 0;
    this.helper?.stop();
    this.helper = new HelperProcess({
      file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'AudioHelper.exe'),
      onLine: (line) => {
        const s: AudioReply = JSON.parse(line);
        if (s.commandError) {
          this.log('warn', 'Audio helper rejected a hotkey');
        }
        this.audio = s.error ? {} : s;
        this.audioHealthy = !s.error;
        this.audioSeen = Date.now();
        this.publish();
      },
      onOffline: () => {
        this.audio = {};
        this.audioHealthy = false;
        this.audioSeen = 0;
        this.publish();
      },
      retry: 3000,
    });
    this.helper.start();
  }
  toggle(app: keyof AudioState) {
    if (this.audio[app]?.available) {
      this.helper?.send('toggle:' + app);
    }
  }
  mic(key: string | undefined) {
    if (key && this.audioHealthy) {
      this.helper?.send('key:' + key);
    }
  }
  request(type: string): Promise<StreamStatus> {
    return new Promise((resolve, reject) => {
      if (this.stopped || !this.identified || !this.ws) {
        return reject(new Error('OBS offline'));
      }
      this.counter += 1;
      const id = String(this.counter);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('OBS timeout'));
      }, 3000);
      this.pending.set(id, { reject, resolve, timer });
      try {
        this.ws.send(JSON.stringify({ d: { requestId: id, requestType: type }, op: 6 }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  connectObs() {
    try {
      const c = {
        host: this.config.obsHost || '127.0.0.1',
        password: this.config.obsPassword || '',
        port: this.config.obsPort || 4455,
      };
      const ws = new WebSocket(`ws://${c.host}:${c.port}`);
      this.ws = ws;
      ws.onopen = () => {
        if (this.ws !== ws || this.stopped) {
          ws.close();
          return;
        }
        this.handshake = setTimeout(() => ws.close(), 5000);
      };
      const resolveObsRequest = (d: ObsMessage['d']) => {
        {
          const p = this.pending.get(d.requestId);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(d.requestId);
            if (d.requestStatus.result) {
              p.resolve(d.responseData);
            } else {
              p.reject(new Error('OBS request failed'));
            }
          }
        }
      };
      const identifyObs = (d: ObsMessage['d']) => {
        const identify: {
          rpcVersion: number;
          eventSubscriptions: number;
          authentication?: string;
        } = { eventSubscriptions: 64, rpcVersion: 1 };
        if (d.authentication) {
          const secret = crypto
            .createHash('sha256')
            .update(c.password + d.authentication.salt)
            .digest('base64');
          identify.authentication = crypto
            .createHash('sha256')
            .update(secret + d.authentication.challenge)
            .digest('base64');
        }
        ws.send(JSON.stringify({ d: identify, op: 1 }));
      };
      const acceptObsSession = async () => {
        clearTimeout(this.handshake);
        this.identified = true;
        const s = await this.request('GetStreamStatus');
        if (this.ws === ws && !this.stopped) {
          this.guard.status(s.outputActive, s.outputReconnecting);
        }
      };
      ws.onmessage = async (event) => {
        if (this.ws !== ws) {
          return;
        }
        try {
          const { op, d }: ObsMessage = JSON.parse(String(event.data));
          if (op === 0) {
            identifyObs(d);
          }
          if (op === 2) {
            await acceptObsSession();
          }
          if (op === 7) {
            resolveObsRequest(d);
          }
          if (op === 5 && d.eventType === 'StreamStateChanged') {
            const s = d.eventData;
            this.guard.status(
              s.outputActive,
              !['OBS_WEBSOCKET_OUTPUT_STARTED', 'OBS_WEBSOCKET_OUTPUT_STOPPED'].includes(
                s.outputState,
              ),
            );
          }
        } catch {
          if (this.ws === ws && !this.stopped) {
            this.guard.offline();
            ws.close();
          }
        }
      };
      // A failed CONNECTING socket may emit only error. Handle both events once,
      // without recursively closing from inside Undici's error callback.
      const disconnected = () => {
        if (this.ws !== ws) {
          return;
        }
        this.ws = null;
        this.identified = false;
        this.guard.offline();
        clearTimeout(this.handshake);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('OBS disconnected'));
        }
        this.pending.clear();
        if (!this.stopped) {
          this.obsRetry = setTimeout(() => this.connectObs(), 5000);
        }
      };
      ws.onerror = disconnected;
      ws.onclose = disconnected;
    } catch (error) {
      this.log(
        'warn',
        'OBS setup: ' +
          (error instanceof Error ? error.name : undefined) +
          ' / ' +
          (error instanceof Error && 'code' in error ? error.code : 'no code'),
      );
      this.guard.offline();
      if (!this.stopped) {
        this.obsRetry = setTimeout(() => this.connectObs(), 10_000);
      }
    }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.monitor);
    clearInterval(this.holdTick ?? undefined);
    this.holdTick = null;
    clearTimeout(this.audioRetry);
    clearTimeout(this.obsRetry);
    clearTimeout(this.discordRetry);
    clearTimeout(this.handshake);
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
    this.guard?.destroy();
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
    this.guard?.offline();
    this.helper?.stop();
    this.helper = null;
    this.audioHealthy = false;
    this.audioSeen = 0;
    const { ws } = this;
    this.ws = null;
    this.identified = false;
    ws?.close();
    const ds = this.discordSock;
    this.discordSock = null;
    this.discord = { connected: false, deaf: null, mute: null };
    ds?.destroy();
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
    for (const p of this.pending?.values() || []) {
      clearTimeout(p.timer);
      p.reject(new Error('Stopped'));
    }
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Companion may invoke callbacks or cleanup before init has assigned declared fields.
    this.pending?.clear();
  }
  destroy(): Promise<void> {
    this.stop();
    return Promise.resolve();
  }
}
export const UpgradeScripts: CompanionStaticUpgradeScript<JsonObject>[] = [];
