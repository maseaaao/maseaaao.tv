import { InstanceBase, InstanceStatus } from '@companion-module/base';
import { HelperProcess } from '../shared/helper-process.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export default class SystemMicrophone extends InstanceBase {
  async init(config) {
    this.setVariableDefinitions({
      state: { name: 'Состояние микрофона' },
      volume: { name: 'Громкость Windows (%)' },
      device: { name: 'Аудиоустройство' },
      available: { name: 'Микрофон доступен' },
    });
    this.setActionDefinitions({
      toggle: { name: 'Переключить микрофон', options: [], callback: () => this.send('toggle') },
      mute: { name: 'Выключить микрофон', options: [], callback: () => this.send('mute') },
      unmute: { name: 'Включить микрофон', options: [], callback: () => this.send('unmute') },
    });
    this.setFeedbackDefinitions({
      muted: {
        type: 'boolean',
        name: 'Микрофон выключен',
        options: [],
        defaultStyle: { bgcolor: 11739175, color: 16777215 },
        callback: () => this.available && this.muted,
      },
      unavailable: {
        type: 'boolean',
        name: 'Аудиоустройство недоступно',
        options: [],
        defaultStyle: { bgcolor: 6513507, color: 16777215 },
        callback: () => !this.available,
      },
    });
    this.setPresetDefinitions(
      [
        { id: 'mic', name: 'Микрофон', definitions: ['mic'] },
        { id: 'speaker', name: 'Динамики', definitions: ['speaker'] },
      ],
      {
        mic: {
          type: 'simple',
          name: 'Микрофон: звук и громкость',
          style: {
            text: '🎤 $(local-system-microphone:state)\n$(local-system-microphone:volume)%',
            size: 'auto',
            color: 16777215,
            bgcolor: 1793104,
          },
          steps: [{ down: [{ actionId: 'toggle', options: {} }], up: [] }],
          feedbacks: [
            { feedbackId: 'muted', options: {}, style: { bgcolor: 11739175, color: 16777215 } },
            {
              feedbackId: 'unavailable',
              options: {},
              style: { bgcolor: 6513507, color: 16777215 },
            },
          ],
        },
        speaker: {
          type: 'simple',
          name: 'Динамики: звук и громкость',
          style: {
            text: '🔊 $(local-system-microphone:state)\n$(local-system-microphone:volume)%',
            size: 'auto',
            color: 16777215,
            bgcolor: 1793104,
          },
          steps: [{ down: [{ actionId: 'toggle', options: {} }], up: [] }],
          feedbacks: [
            { feedbackId: 'muted', options: {}, style: { bgcolor: 11739175, color: 16777215 } },
            {
              feedbackId: 'unavailable',
              options: {},
              style: { bgcolor: 6513507, color: 16777215 },
            },
          ],
        },
      },
    );
    await this.configUpdated(config);
  }
  getConfigFields() {
    return [
      {
        type: 'dropdown',
        id: 'dataFlow',
        label: 'Тип устройства',
        width: 12,
        default: 'capture',
        choices: [
          { id: 'capture', label: 'Микрофон (вход)' },
          { id: 'render', label: 'Динамики / наушники (выход)' },
        ],
      },
      {
        type: 'textinput',
        id: 'deviceId',
        label: 'ID устройства Windows (пусто = системное)',
        width: 12,
        default: '',
      },
    ];
  }
  async configUpdated(config) {
    this.stop();
    this.config = config;
    if (!['capture', 'render'].includes(config?.dataFlow)) {
      this.offline('Выберите тип аудиоустройства');
      this.updateStatus(InstanceStatus.BadConfig, 'Выберите тип аудиоустройства');
      return;
    }
    this.start();
  }
  offline(message) {
    this.lastPublished = null;
    this.available = false;
    this.setVariableValues({ state: 'НЕТ СВЯЗИ', volume: '—', device: '', available: false });
    this.updateStatus(InstanceStatus.ConnectionFailure, message);
    this.checkFeedbacks('muted', 'unavailable');
  }
  start() {
    this.offline('Подключение к аудиоустройству');
    this.helper = new HelperProcess({
      file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'SystemAudioHelper.exe'),
      args: [this.config.deviceId || '', this.config.dataFlow],
      timeout: 6000,
      onLine: (line) => {
        const value = JSON.parse(line);
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
            state: value.muted ? 'ВЫКЛ' : 'ВКЛ',
            volume: value.volume,
            device: value.name,
            available: true,
          });
          this.updateStatus(InstanceStatus.Ok);
          this.checkFeedbacks('muted', 'unavailable');
        }
      },
      onOffline: (message) => this.offline(message),
    });
    this.helper.start();
  }
  send(command) {
    if (!this.available || !this.helper?.send(JSON.stringify({ command })))
      this.offline('Аудиоустройство недоступно');
  }
  stop() {
    this.helper?.stop();
    this.helper = null;
    this.lastPublished = null;
  }
  async destroy() {
    this.stop();
  }
}
export const UpgradeScripts = [];
