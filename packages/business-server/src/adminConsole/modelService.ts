import { AdminConsoleSettingsModel, type LobeChatDatabase } from '@lobechat/database';
import type {
  AdminConsoleAiConfig,
  AdminConsoleAiConfigUpdate,
  AdminConsoleAiConfigView,
  AdminConsoleAiDefaults,
  AdminConsoleAiKey,
  AdminConsoleAiKeySummary,
  AdminConsoleAiLastTest,
  AdminConsoleModelServiceConfig,
  CompanyModel,
  CompanyModelCapability,
} from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR, COMPANY_MODEL_CAPABILITIES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { AiModelTypeSchema } from 'model-bank';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

/**
 * Admin console model service (CUST-008 §4.1 / §5.2 / §7).
 *
 * Owns `admin_console_settings.config.ai`: reads return only the key's last 4
 * characters, writes validate the catalog, encrypt the pasted key through the
 * existing KeyVaults gatekeeper, and reuse the P1 singleton row with its
 * `updatedAt` as an optimistic lock.
 */

/** Structural subset of the gatekeeper used here; keeps tests free of Env setup. */
export interface KeyVaultEncryptor {
  encrypt: (plaintext: string) => Promise<string>;
}

export interface AdminConsoleModelServiceOptions {
  /** Test seam: defaults to the repo KeyVaultsGateKeeper backed by `KEY_VAULTS_SECRET`. */
  gatekeeper?: KeyVaultEncryptor;
  /** Test seam for deterministic `updatedAt` / key rotation timestamps. */
  now?: () => Date;
}

const MAX_BASE_URL_LENGTH = 2048;
const MAX_API_KEY_LENGTH = 4096;
const MAX_MODELS = 500;
const MAX_MODEL_ID_LENGTH = 200;
const MAX_MODEL_NAME_LENGTH = 200;

const DEFAULT_AI_CONFIG: AdminConsoleAiConfigView = {
  apiKey: null,
  baseURL: '',
  enabled: false,
  models: [],
};

const invalidConfig = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

/** `http(s)` only: the runtime injects this address into server-side requests. */
export const validateBaseURL = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_BASE_URL_LENGTH) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidBaseUrl);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidBaseUrl);
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidBaseUrl);
  }

  // Credentials belong in the key, not in a URL we persist and log.
  if (url.username || url.password) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidBaseUrl);
  }

  return trimmed;
};

const isCapability = (value: unknown): value is CompanyModelCapability =>
  typeof value === 'string' && (COMPANY_MODEL_CAPABILITIES as readonly string[]).includes(value);

const normalizeModel = (model: CompanyModel): CompanyModel => {
  const id = typeof model.id === 'string' ? model.id.trim() : '';
  const name = typeof model.name === 'string' ? model.name.trim() : '';

  if (!id || id.length > MAX_MODEL_ID_LENGTH || !name || name.length > MAX_MODEL_NAME_LENGTH) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModel);
  }

  if (!AiModelTypeSchema.safeParse(model.type).success) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModelType);
  }

  if (typeof model.open !== 'boolean' || (model.source !== 'sync' && model.source !== 'manual')) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModel);
  }

  if (
    model.contextWindowTokens !== undefined &&
    (!Number.isInteger(model.contextWindowTokens) || model.contextWindowTokens <= 0)
  ) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModel);
  }

  if (model.removedAt !== undefined && Number.isNaN(Date.parse(model.removedAt))) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModel);
  }

  let capabilities: CompanyModelCapability[] | undefined;
  if (model.capabilities !== undefined) {
    if (
      !Array.isArray(model.capabilities) ||
      model.capabilities.some((item) => !isCapability(item))
    ) {
      throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModel);
    }
    capabilities = [...new Set(model.capabilities)];
    if (capabilities.length !== model.capabilities.length) {
      throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModel);
    }
  }

  return {
    ...(capabilities ? { capabilities } : {}),
    ...(model.contextWindowTokens !== undefined
      ? { contextWindowTokens: model.contextWindowTokens }
      : {}),
    id,
    name,
    open: model.open,
    ...(model.pending === true ? { pending: true } : {}),
    ...(model.removedAt ? { removedAt: new Date(model.removedAt).toISOString() } : {}),
    source: model.source,
    type: model.type,
  };
};

/** The catalog is the source of truth for ids; the type enum is the source for types. */
export const validateCompanyModels = (models: CompanyModel[]): CompanyModel[] => {
  if (!Array.isArray(models) || models.length > MAX_MODELS) {
    throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidModel);
  }

  const seen = new Set<string>();
  return models.map((model) => {
    const normalized = normalizeModel(model);
    if (seen.has(normalized.id)) {
      throw invalidConfig(ADMIN_CONSOLE_ERROR.duplicateModelId);
    }
    seen.add(normalized.id);
    return normalized;
  });
};

export const validateDefaults = (
  defaults: AdminConsoleAiDefaults,
  models: CompanyModel[],
): AdminConsoleAiDefaults => {
  const ids = new Set(models.map((model) => model.id));
  const result: AdminConsoleAiDefaults = {};

  for (const key of ['chat', 'embedding', 'title', 'verify'] as const) {
    const value = defaults[key];
    if (value === undefined) continue;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || !ids.has(trimmed)) {
      throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidDefaultModel);
    }
    result[key] = trimmed;
  }

  return result;
};

/** The only shape that leaves the server: ciphertext is dropped, key becomes last4. */
export const toConfigView = (ai: AdminConsoleAiConfig | undefined): AdminConsoleAiConfigView => {
  if (!ai) return { ...DEFAULT_AI_CONFIG, models: [] };

  const apiKey: AdminConsoleAiKeySummary | null = ai.apiKey
    ? { last4: ai.apiKey.last4, updatedAt: ai.apiKey.updatedAt, updatedBy: ai.apiKey.updatedBy }
    : null;

  return {
    apiKey,
    baseURL: ai.baseURL ?? '',
    ...(ai.defaults ? { defaults: { ...ai.defaults } } : {}),
    enabled: ai.enabled === true,
    ...(ai.lastTest ? { lastTest: { ...ai.lastTest } } : {}),
    models: (ai.models ?? []).map((model) => ({ ...model })),
  };
};

export class AdminConsoleModelService {
  private readonly model: AdminConsoleSettingsModel;
  private gatekeeper?: KeyVaultEncryptor;
  private readonly now: () => Date;

  constructor(
    db: LobeChatDatabase,
    private readonly actingUserId: string,
    options: AdminConsoleModelServiceOptions = {},
  ) {
    this.model = new AdminConsoleSettingsModel(db);
    this.gatekeeper = options.gatekeeper;
    this.now = options.now ?? (() => new Date());
  }

  getConfig = async (): Promise<AdminConsoleModelServiceConfig> => {
    const row = await this.model.getSettings();

    return {
      config: toConfigView(row?.config?.ai),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  };

  updateConfig = async (
    input: AdminConsoleAiConfigUpdate,
  ): Promise<AdminConsoleModelServiceConfig> => {
    const current = await this.model.getSettings();
    const currentAi = current?.config?.ai;

    const models =
      input.models === undefined ? (currentAi?.models ?? []) : validateCompanyModels(input.models);

    const baseURL =
      input.baseURL === undefined ? (currentAi?.baseURL ?? '') : validateBaseURL(input.baseURL);

    // Validate defaults against the final catalog too: replacing `models` must
    // not leave a default pointing at a model that just left the list.
    const requestedDefaults = input.defaults === undefined ? currentAi?.defaults : input.defaults;
    const defaults =
      requestedDefaults === undefined ? undefined : validateDefaults(requestedDefaults, models);

    const apiKey =
      input.apiKey === undefined
        ? (currentAi?.apiKey ?? null)
        : await this.encryptKey(input.apiKey);

    if (input.enabled && (!baseURL || !apiKey)) {
      throw invalidConfig(ADMIN_CONSOLE_ERROR.providerNotConfigured);
    }

    const nextAi: AdminConsoleAiConfig = {
      apiKey,
      baseURL,
      ...(defaults ? { defaults } : {}),
      enabled: input.enabled === true,
      ...(currentAi?.lastTest ? { lastTest: currentAi.lastTest } : {}),
      models,
    };

    const expectedUpdatedAt =
      input.expectedUpdatedAt === undefined ? undefined : new Date(input.expectedUpdatedAt);

    const row = await this.model.updateSettingsConfig(
      { ai: nextAi },
      this.actingUserId,
      expectedUpdatedAt,
    );

    return {
      config: toConfigView(row.config.ai),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  };

  private encryptKey = async (plaintext: string): Promise<AdminConsoleAiKey> => {
    const key = plaintext.trim();
    // A key shorter than its own last4 would make the masked view reveal it.
    if (key.length < 8 || key.length > MAX_API_KEY_LENGTH) {
      throw invalidConfig(ADMIN_CONSOLE_ERROR.invalidApiKey);
    }

    const gatekeeper = await this.getGatekeeper();
    const ciphertext = await gatekeeper.encrypt(key);

    return {
      ciphertext,
      last4: key.slice(-4),
      updatedAt: this.now().toISOString(),
      updatedBy: this.actingUserId,
    };
  };

  private getGatekeeper = async (): Promise<KeyVaultEncryptor> => {
    if (!this.gatekeeper) {
      this.gatekeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    }
    return this.gatekeeper;
  };

  /** Kept for T-58 / T-59: the connection test records its outcome here. */
  recordLastTest = async (
    lastTest: AdminConsoleAiLastTest,
  ): Promise<AdminConsoleModelServiceConfig> => {
    const current = await this.model.getSettings();
    const currentAi = current?.config?.ai;

    if (!currentAi) {
      throw invalidConfig(ADMIN_CONSOLE_ERROR.providerNotConfigured);
    }

    const row = await this.model.updateSettingsConfig(
      { ai: { ...currentAi, lastTest } },
      this.actingUserId,
    );

    return {
      config: toConfigView(row.config.ai),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  };
}

export const createAdminConsoleModelService = (
  db: LobeChatDatabase,
  actingUserId: string,
  options?: AdminConsoleModelServiceOptions,
) => new AdminConsoleModelService(db, actingUserId, options);
