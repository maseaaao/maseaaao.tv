export interface TwitchCategory {
  id: string;
  imageUrl: string;
  name: string;
}

export interface TwitchState {
  accountName?: string;
  broadcasterId?: string;
  categoryId?: string;
  categoryImageUrl?: string;
  categoryName?: string;
  connected: boolean;
  live: boolean;
  login?: string;
  tags?: string[];
  title?: string;
}

export interface StreamState {
  apiVersion: number;
  templates: TemplateState;
  twitch: TwitchState;
}

export interface TemplateState {
  configured: boolean;
  subtitle: string;
  twitchTemplate: string;
}

export interface ActionResponse {
  apiVersion: number;
  command: string;
  data: Record<string, unknown> | null;
  error: { message: string } | null;
  ok: boolean;
  requestId: string;
}

export interface ConnectionSettings {
  endpoint: string;
  host: string;
  lastSubtitle: string;
  password: string;
  port: number;
  rememberPassword: boolean;
  twitchEnabled: boolean;
  twitchTemplate: string;
}

export interface ActionSummary {
  enabled: boolean;
  group: string;
  id: string;
  name: string;
}

export type Platform = 'twitch';

export interface AllForm {
  subtitle: string;
  twitchCategory: TwitchCategory | null;
  twitchCategoryQuery: string;
  twitchTagDraft: string;
  twitchTags: string[];
  twitchTitle: string;
  twitchTitleMode: 'subtitle' | 'full';
}
