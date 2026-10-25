import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CompanionStaticUpgradeScript,
  InstanceBase,
  InstanceStatus,
  type JsonObject,
  type SomeCompanionConfigField,
} from '@companion-module/base';
import { HelperProcess } from '../shared/helper-process.ts';

export interface MicrophoneConfig {
  dataFlow?: string;
  deviceId?: string;
}
interface AudioStatus {
  available: boolean;
  error?: string;
  muted: boolean;
  name: string;
  volume: number;
}
export default class SystemMicrophone extends InstanceBase {
  declare config: MicrophoneConfig;
  declare available: boolean;
  declare muted: boolean;
  helper: HelperProcess | null = null;
  lastPublished: string | null = null;
  async init(config: MicrophoneConfig) {
    this.setVariableDefinitions({
      available: { name: 'Микрофон доступен' },
      device: { name: 'Аудиоустройство' },
      state: { name: 'Состояние микрофона' },
      volume: { name: 'Громкость Windows (%)' },
    });
    this.setActionDefinitions({
      mute: { callback: () => this.send('mute'), name: 'Выключить микрофон', options: [] },
      toggle: { callback: () => this.send('toggle'), name: 'Переключить микрофон', options: [] },
      unmute: { callback: () => this.send('unmute'), name: 'Включить микрофон', options: [] },
    });
    this.setFeedbackDefinitions({
      muted: {
        callback: () => this.available && this.muted,
        defaultStyle: { bgcolor: 11_739_175, color: 16_777_215 },
        name: 'Микрофон выключен',
        options: [],
        type: 'boolean',
      },
      unavailable: {
        callback: () => !this.available,
        defaultStyle: { bgcolor: 6_513_507, color: 16_777_215 },
        name: 'Аудиоустройство недоступно',
        options: [],
        type: 'boolean',
      },
    });
    this.setPresetDefinitions(
      [
        { definitions: ['mic'], id: 'mic', name: 'Микрофон' },
        { definitions: ['speaker'], id: 'speaker', name: 'Динамики' },
      ],
      {
        mic: {
          feedbacks: [
            { feedbackId: 'muted', options: {}, style: { bgcolor: 11_739_175, color: 16_777_215 } },
            {
              feedbackId: 'unavailable',
              options: {},
              style: { bgcolor: 6_513_507, color: 16_777_215 },
            },
          ],
          name: 'Микрофон: звук и громкость',
          steps: [{ down: [{ actionId: 'toggle', options: {} }], up: [] }],
          style: {
            bgcolor: 1_793_104,
            color: 16_777_215,
            size: 'auto',
            text: '🎤 $(local-system-microphone:state)\n$(local-system-microphone:volume)%',
          },
          type: 'simple',
        },
        speaker: {
          feedbacks: [
            { feedbackId: 'muted', options: {}, style: { bgcolor: 11_739_175, color: 16_777_215 } },
            {
              feedbackId: 'unavailable',
              options: {},
              style: { bgcolor: 6_513_507, color: 16_777_215 },
            },
          ],
          name: 'Динамики: звук и громкость',
          steps: [{ down: [{ actionId: 'toggle', options: {} }], up: [] }],
          style: {
            bgcolor: 1_793_104,
            color: 16_777_215,
            size: 'auto',
            text: '🔊 $(local-system-microphone:state)\n$(local-system-microphone:volume)%',
          },
          type: 'simple',
        },
      },
    );
    await this.configUpdated(config);
  }
  getConfigFields(): SomeCompanionConfigField[] {
    return [
      {
        choices: [
          { id: 'capture', label: 'Микрофон (вход)' },
          { id: 'render', label: 'Динамики / наушники (выход)' },
        ],
        default: 'capture',
        id: 'dataFlow',
        label: 'Тип устройства',
        type: 'dropdown',
        width: 12,
      },
      {
        default: '',
        id: 'deviceId',
        label: 'ID устройства Windows (пусто = системное)',
        type: 'textinput',
        width: 12,
      },
    ];
  }
  configUpdated(config: MicrophoneConfig) {
    this.stop();
    this.config = config;
    if (typeof config.dataFlow !== 'string' || !['capture', 'render'].includes(config.dataFlow)) {
      this.offline('Выберите тип аудиоустройства');
      this.updateStatus(InstanceStatus.BadConfig, 'Выберите тип аудиоустройства');
      return Promise.resolve();
    }
    this.start(config.dataFlow);
    return Promise.resolve();
  }
  offline(message: string) {
    this.lastPublished = null;
    this.available = false;
    this.setVariableValues({ available: false, device: '', state: 'НЕТ СВЯЗИ', volume: '—' });
    this.updateStatus(InstanceStatus.ConnectionFailure, message);
    this.checkFeedbacks('muted', 'unavailable');
  }
  start(dataFlow: string) {
    this.offline('Подключение к аудиоустройству');
    this.helper = new HelperProcess({
      args: [this.config.deviceId || '', dataFlow],
      file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'SystemAudioHelper.exe'),
      onLine: (line) => {
        const value: AudioStatus = JSON.parse(line);
        if (!value.available) {
          this.offline(value.error || 'Аудиоустройство недоступно');
          return;
        }
        const signature = JSON.stringify(value);
        this.available = true;
        this.muted = value.muted;
        if (signature !== this.lastPublished) {
          this.lastPublished = signature;
          this.setVariableValues({
            available: true,
            device: value.name,
            state: value.muted ? 'ВЫКЛ' : 'ВКЛ',
            volume: value.volume,
          });
          this.updateStatus(InstanceStatus.Ok);
          this.checkFeedbacks('muted', 'unavailable');
        }
      },
      onOffline: (message) => this.offline(message),
      timeout: 6000,
    });
    this.helper.start();
  }
  send(command: string) {
    if (!(this.available && this.helper?.send(JSON.stringify({ command })))) {
      this.offline('Аудиоустройство недоступно');
    }
  }
  stop() {
    this.helper?.stop();
    this.helper = null;
    this.lastPublished = null;
  }
  destroy() {
    this.stop();
    return Promise.resolve();
  }
}
export const UpgradeScripts: CompanionStaticUpgradeScript<JsonObject>[] = [];
