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
 * Why a catalog model cannot back this default; `undefined` when it can.
 *
 * `resolveCompanyServiceDefaults` only honours a model users can see
 * (`getVisibleCompanyModels`: open and not removed upstream). A default that
 * points anywhere else saves fine and is then dropped silently, so the picker
 * must not offer such a model and a stored one must be reported with the
 * reason — "not usable" without a reason is what let admins save `glm-latest`
 * and see nothing change.
 *
 * Acceptance reads screenshot evidence, so only a vision model can serve
 * `verify`; a text-only one would fail at verification time, long after the
 * admin saved it.
 */
export type DefaultModelIssue = 'closed' | 'missing' | 'removed' | 'type' | 'vision';

const issueOfModel = (model: CompanyModel, key: DefaultModelKey): DefaultModelIssue | undefined => {
  if (!DEFAULT_MODEL_TYPES[key].includes(model.type)) return 'type';
  if (model.removedAt) return 'removed';
  if (model.open !== true) return 'closed';
  if (key === 'verify' && !(model.capabilities ?? []).includes('vision')) return 'vision';
  return undefined;
};

/** Why the stored id cannot serve this default; `undefined` for unset or fine. */
export const defaultModelIssue = (
  models: CompanyModel[],
  key: DefaultModelKey,
  id?: string,
): DefaultModelIssue | undefined => {
  if (!id) return undefined;
  const model = models.find((item) => item.id === id);
  return model ? issueOfModel(model, key) : 'missing';
};

/** Whether a catalog model may be offered as this default. */
export const acceptsDefaultModel = (model: CompanyModel, key: DefaultModelKey) =>
  issueOfModel(model, key) === undefined;

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
) => defaultModelIssue(models, key, id) === undefined;

/**
 * The warning under a field whose stored default cannot take effect, one per
 * reason. "Not usable" alone left the admin unable to tell that the model is
 * simply not open to users, so the closed / removed cases get their own copy.
 */
const ISSUE_MESSAGE_KEY = {
  closed: 'modelService.defaults.closed',
  missing: 'modelService.defaults.invalid',
  removed: 'modelService.defaults.removed',
  type: 'modelService.defaults.invalid',
  vision: 'modelService.defaults.verifyInvalid',
} as const satisfies Record<DefaultModelIssue, string>;

/** Short tag on the stale option, where a full sentence would not fit. */
const ISSUE_TAG_KEY = {
  closed: 'modelService.defaults.closedTag',
  missing: 'modelService.defaults.unsupported',
  removed: 'modelService.defaults.removedTag',
  type: 'modelService.defaults.unsupported',
  vision: 'modelService.defaults.unsupported',
} as const satisfies Record<DefaultModelIssue, string>;

export const defaultModelMessageKey = (issue: DefaultModelIssue) => ISSUE_MESSAGE_KEY[issue];

export const defaultModelTagKey = (issue: DefaultModelIssue) => ISSUE_TAG_KEY[issue];

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
