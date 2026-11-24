import type {
  AdminConsoleAiConfigView,
  AdminConsoleAiDefaults,
  CompanyModel,
  CompanyModelCapability,
} from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import dayjs from 'dayjs';
import type { AiModelType } from 'model-bank';

import { sx } from '@/styles/sx';

import { styles } from './style';

/** Order the console shows model types in (§5.4). */
export const MODEL_TYPES: AiModelType[] = [
  'chat',
  'image',
  'video',
  'embedding',
  'asr',
  'tts',
  'text2music',
  'realtime',
  'decision',
];

/** The form draft: server config plus the plaintext key the admin is typing. */
export interface ModelServiceForm {
  /** Empty once saved; the stored key is only shown as `last4`. */
  apiKey: string;
  baseURL: string;
  defaults: AdminConsoleAiDefaults;
  enabled: boolean;
  models: CompanyModel[];
}

export const toForm = (config: AdminConsoleAiConfigView): ModelServiceForm => ({
  apiKey: '',
  baseURL: config.baseURL,
  defaults: { ...config.defaults },
  enabled: config.enabled,
  models: config.models.map((model) => ({ ...model })),
});

export const toDefaults = (defaults: AdminConsoleAiDefaults): AdminConsoleAiDefaults => {
  const next: AdminConsoleAiDefaults = {};
  for (const key of ['chat', 'embedding', 'title', 'verify'] as const) {
    const value = defaults[key]?.trim();
    if (value) next[key] = value;
  }
  return next;
};

export const formatContext = (tokens?: number) => {
  if (!tokens) return '—';
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
};

export const formatDateTime = (value?: string | null) =>
  value ? dayjs(value).format('MM-DD HH:mm') : '—';

export const errorCodeOf = (error: unknown): string | undefined => {
  const message = (error as Error)?.message;
  return typeof message === 'string' ? message : undefined;
};

export const isConfigConflict = (error: unknown) =>
  errorCodeOf(error) === ADMIN_CONSOLE_ERROR.configConflict;

/** Field classes the row layout paints once, so cards stay markup-only. */
export const fieldRowClass = (last = false) => sx(styles.fieldRow, last && styles.fieldRowLast);

export const modelTypeLabelKey = <T extends AiModelType>(type: T) =>
  `adminConsole.modelService.type.${type}` as const;

export const capabilityLabelKey = <T extends CompanyModelCapability>(capability: T) =>
  `adminConsole.modelService.capability.${capability}` as const;
