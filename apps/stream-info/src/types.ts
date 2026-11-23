export interface TwitchCategory {
  id: string;
  imageUrl: string;
  name: string;
}

export interface YouTubeCategory {
  id: string;
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

export interface YouTubeState {
  accountName?: string;
  broadcastId?: string;
  categoryId?: string;
  categoryName?: string;
  channelId?: string;
  connected: boolean;
  live: boolean;
  status?: string;
  tags?: string[];
  title?: string;
}

export interface StreamState {
  apiVersion: number;
  templates: TemplateState;
  twitch: TwitchState;
  youtube: YouTubeState;
}

export interface TemplateState {
  configured: boolean;
  subtitle: string;
  twitchTemplate: string;
  youtubeTemplate: string;
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
  youtubeEnabled: boolean;
  youtubeTemplate: string;
}

export interface ActionSummary {
  enabled: boolean;
  group: string;
  id: string;
  name: string;
}

export type Platform = 'twitch' | 'youtube';

export interface AllForm {
  subtitle: string;
  tagDraft: string;
  tags: string[];
  twitchCategory: TwitchCategory | null;
  twitchCategoryQuery: string;
  twitchTitle: string;
  twitchTitleMode: 'subtitle' | 'full';
  youtubeCategoryName: string;
  youtubeTitle: string;
  youtubeTitleMode: 'subtitle' | 'full';
}
