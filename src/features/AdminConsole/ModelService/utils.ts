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

/** The four administrator defaults, in the order the personal page shows its tiers. */
export const DEFAULT_MODEL_KEYS = ['chat', 'title', 'verify', 'embedding'] as const;

export type DefaultModelKey = (typeof DEFAULT_MODEL_KEYS)[number];

/** Which catalog types may back each default. */
export const DEFAULT_MODEL_TYPES: Record<DefaultModelKey, AiModelType[]> = {
  chat: ['chat'],
  embedding: ['embedding'],
  title: ['chat'],
  verify: ['chat'],
};

/**
 * Whether a catalog model may be used as this default. Acceptance reads
 * screenshot evidence, so only a vision model can serve `verify`; a text-only
 * one would fail at verification time, long after the admin saved it.
 */
export const acceptsDefaultModel = (model: CompanyModel, key: DefaultModelKey) =>
  DEFAULT_MODEL_TYPES[key].includes(model.type) &&
  (key === 'chat' ? !!model.open : true) &&
  (key === 'verify' ? (model.capabilities ?? []).includes('vision') : true);

/**
 * Whether a stored default still points at a model that can serve it. An unset
 * value is always fine (it inherits). A value that no longer qualifies — saved
 * before the rule existed, or a model edited afterwards — is reported so the
 * card can ask for a new pick instead of saving it silently.
 */
export const isDefaultModelCompliant = (
  models: CompanyModel[],
  key: DefaultModelKey,
  id?: string,
) => {
  if (!id) return true;
  const model = models.find((item) => item.id === id);
  return !!model && acceptsDefaultModel(model, key);
};

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
  for (const key of DEFAULT_MODEL_KEYS) {
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
  `modelService.type.${type}` as const;

export const capabilityLabelKey = <T extends CompanyModelCapability>(capability: T) =>
  `modelService.capability.${capability}` as const;
