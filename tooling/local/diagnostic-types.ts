import type { Action } from './action-targets.ts';

export interface StreamerbotSettings {
  http: { address?: string; port: number; mapping?: Record<string, unknown> };
  websockets: { address?: string; port: number; endpoint?: string; authPassword?: string };
}
export interface CompanionConfig {
  bind_ip?: string;
  http_port: number;
}
interface CompanionInstance {
  config: Record<string, string>;
  enabled: boolean;
  label: string;
  moduleId: string;
  moduleVersionId?: string;
  [key: string]: unknown;
}
export interface CompanionExport {
  companionBuild?: string;
  instances: Record<string, CompanionInstance>;
  pages: unknown;
}
export interface CompanionConnection {
  enabled: boolean;
  id: string;
  label: string;
  moduleId: string;
  status?: { level?: string; category?: string };
}
export interface ButtonEntity {
  connectionId?: string;
  definitionId?: string;
  disabled?: boolean;
  options?: { url?: { value?: string }; body?: { value: string } };
}
export interface ActionDocument {
  actions: Action[];
}
export interface StorageObservation {
  integrity: string;
  matchesLive: boolean;
  source: string;
  storedConnections: number;
}
export interface DiagnosticsReport {
  checkedAt: string;
  checks: {
    streamerbotHttp?: { available: boolean; actions: number };
    companion?: {
      available: boolean;
      connections: {
        label: string;
        module: string;
        enabled: boolean;
        status?: string;
        version?: string;
      }[];
    };
    companionStoredConnections?: {
      matchesLive: boolean;
      source: string;
      storedConnections?: number;
      integrity?: string;
      localReadMatchesLive?: boolean;
    };
    buttonReferences?: { checked: number };
    streamerbotWebsocket?: { available: boolean };
    obs?: { available: boolean; streaming: boolean; recording: boolean; inputs: number };
    actionTargets?: { checked: number; source: string; note: string };
    obsMicrophones?: { name: string; selectedDeviceValid: boolean }[];
    obsResources?: { browserSources: number; mediaFiles: { name: string; exists: boolean }[] };
    streamInfo?: { available: boolean };
  };
  issues: string[];
  ok?: boolean;
  ready?: boolean;
  versions: { companion?: string; streamerbot?: string; obs?: string };
  warnings: string[];
}
interface Authentication {
  challenge: string;
  salt: string;
}
export interface StreamerbotMessage {
  authentication?: Authentication;
  id?: string;
  info?: { version?: string };
  request?: string;
  status?: string;
}
export interface ObsConnection {
  default?: boolean;
  host: string;
  password?: string;
  port: number;
}
interface ObsInput {
  inputKind: string;
  inputName: string;
}
export interface ObsResponses {
  GetInputList: { inputs: ObsInput[] };
  GetInputPropertiesListPropertyItems: {
    propertyItems: { itemValue: string; itemEnabled: boolean }[];
  };
  GetInputSettings: {
    inputSettings: {
      device_id?: string;
      is_local_file?: boolean;
      local_file?: string;
      url?: string;
      file?: string;
    };
  };
  GetRecordStatus: { outputActive: boolean };
  GetSceneList: { scenes: { sceneName: string }[] };
  GetStreamStatus: { outputActive: boolean };
  GetVersion: { obsVersion: string };
}
export interface ObsMessage {
  d: {
    authentication?: Authentication;
    requestId?: string;
    requestStatus: { result: boolean };
    responseData: unknown;
  };
  op: number;
}
