import net from 'node:net';

import type { LobeChatDatabase } from '@lobechat/database';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { type SSRFOptions, ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import type {
  AdminConsoleAiConfig,
  AdminConsoleAiDefaults,
  CompanyModel,
  ProviderConfig,
} from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import type { AiFullModelCard } from 'model-bank';
import { ModelProvider } from 'model-bank';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

/**
 * Tellhow enterprise built-in model service (CUST-008 §5.2 / §5.3 / §8.2).
 *
 * The administrator owns the endpoint, the key and the catalog in
 * `admin_console_settings.config.ai`; end users never see or edit them. This
 * module is the single reading layer between that row and the runtime:
 *
 * - `getCompanyProviderRuntime()` reads + decrypts with a 5 s in-process cache;
 * - `getCompanyProviderRuntimeSnapshot()` is the synchronous view the runtime
 *   payload builder needs (`getParamsFromPayload` must stay sync);
 * - `withCompanyProviderCatalog()` merges the catalog into the server provider
 *   config, which is what makes the provider visible to users;
 * - outbound HTTP (connection test / catalog sync) goes through
 *   `companyProviderFetch()`, i.e. `ssrfSafeFetch` with an explicit allowance
 *   for this one admin-configured address.
 *
 * Everything defaults to closed: no row, `enabled: false`, a missing key or a
 * missing endpoint all resolve to `null`, and the provider disappears for
 * users instead of silently falling back to another credential.
 */

export const COMPANY_PROVIDER_ID = ModelProvider.Tellhow;

/** Process-local cache window; a config write invalidates it immediately. */
export const COMPANY_PROVIDER_CACHE_TTL_MS = 5_000;

/** User-facing text for a model request that reaches a disabled service. */
export const COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE =
  'The Tellhow AI service is not available. Your administrator disabled it or has not configured it yet. Please switch to another model.';

/** Runtime shape: decrypted and filtered, so it is never handed to a client. */
export interface CompanyProviderRuntime {
  /** Plaintext gateway key. Server-side only. */
  apiKey: string;
  baseURL: string;
  defaults?: AdminConsoleAiDefaults;
  /** Only `open` models that upstream still lists. */
  models: CompanyModel[];
}

/** Structural decryptor so tests do not need `KEY_VAULTS_SECRET`. */
export interface CompanyProviderKeyDecryptor {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string; wasAuthentic?: boolean }>;
}

export interface CompanyProviderOptions {
  /** Test seam for the KeyVaults gatekeeper. */
  gatekeeper?: CompanyProviderKeyDecryptor;
  /** Test seam for the cache clock. */
  now?: () => number;
  /**
   * Test seam: read `config.ai` directly instead of the settings table. The
   * default reader goes through `AdminConsoleSettingsModel`.
   */
  reader?: (db: LobeChatDatabase) => Promise<AdminConsoleAiConfig | undefined>;
  /** Overrides `COMPANY_PROVIDER_CACHE_TTL_MS`. */
  ttlMs?: number;
}

/** Models the admin offers to everyone: `open` and not removed upstream (§5.4). */
export const getVisibleCompanyModels = (models: CompanyModel[] = []): CompanyModel[] =>
  models.filter((model) => model.open === true && !model.removedAt);

/**
 * Build the runtime from a stored config. Returns `null` for every
 * "not configured" state instead of throwing, so callers can stay total.
 */
export const toCompanyProviderRuntime = (
  ai: AdminConsoleAiConfig | undefined,
  apiKey: string | null,
): CompanyProviderRuntime | null => {
  if (!ai || ai.enabled !== true) return null;
  if (!ai.baseURL || !apiKey) return null;

  return {
    apiKey,
    baseURL: ai.baseURL,
    ...(ai.defaults ? { defaults: ai.defaults } : {}),
    models: getVisibleCompanyModels(ai.models),
  };
};

const readAiConfig = async (db: LobeChatDatabase): Promise<AdminConsoleAiConfig | undefined> => {
  // Loaded lazily: `@lobechat/database` initializes the server pool on import,
  // and this module is reachable from the (build-time loaded) global config.
  const { AdminConsoleSettingsModel } = await import('@lobechat/database');
  const row = await new AdminConsoleSettingsModel(db).getSettings();

  return row?.config?.ai as AdminConsoleAiConfig | undefined;
};

let defaultGatekeeper: CompanyProviderKeyDecryptor | undefined;

const getGatekeeper = async (): Promise<CompanyProviderKeyDecryptor> => {
  defaultGatekeeper ??= await KeyVaultsGateKeeper.initWithEnvKey();
  return defaultGatekeeper;
};

const decryptApiKey = async (
  ai: AdminConsoleAiConfig,
  gatekeeper?: CompanyProviderKeyDecryptor,
): Promise<string | null> => {
  const ciphertext = ai.apiKey?.ciphertext;
  if (!ciphertext) return null;

  const decryptor = gatekeeper ?? (await getGatekeeper());
  const { plaintext } = await decryptor.decrypt(ciphertext);

  return plaintext?.trim() ? plaintext.trim() : null;
};

const loadCompanyProviderRuntime = async (
  db: LobeChatDatabase,
  options: CompanyProviderOptions,
): Promise<CompanyProviderRuntime | null> => {
  const ai = await (options.reader ?? readAiConfig)(db);

  // Check the cheap flags first: a disabled service must not require the
  // KeyVaults secret to be configured.
  if (!ai?.enabled || !ai.baseURL) return null;

  return toCompanyProviderRuntime(ai, await decryptApiKey(ai, options.gatekeeper));
};

interface CompanyProviderCacheEntry {
  expiresAt: number;
  runtime: CompanyProviderRuntime | null;
}

let cacheEntry: CompanyProviderCacheEntry | undefined;
let inflightRead: Promise<CompanyProviderRuntime | null> | undefined;
/** Bumped by `invalidateCompanyProviderCache()` so a slow read cannot repopulate. */
let cacheGeneration = 0;

export const invalidateCompanyProviderCache = (): void => {
  cacheGeneration += 1;
  cacheEntry = undefined;
  inflightRead = undefined;
};

/**
 * Current runtime, read at most once per TTL. Concurrent callers share one
 * read. A failed read keeps the last good runtime (§5.6: a gateway or DB
 * hiccup must not wipe a working configuration).
 */
export const getCompanyProviderRuntime = async (
  db: LobeChatDatabase,
  options: CompanyProviderOptions = {},
): Promise<CompanyProviderRuntime | null> => {
  const now = options.now?.() ?? Date.now();

  if (cacheEntry && cacheEntry.expiresAt > now) return cacheEntry.runtime;

  const generation = cacheGeneration;

  inflightRead ??= loadCompanyProviderRuntime(db, options)
    .catch((error) => {
      console.error('[companyProvider] failed to read config.ai:', error);
      return cacheEntry?.runtime ?? null;
    })
    .then((runtime) => {
      if (generation === cacheGeneration) {
        const expiresAt =
          (options.now?.() ?? Date.now()) + (options.ttlMs ?? COMPANY_PROVIDER_CACHE_TTL_MS);
        cacheEntry = { expiresAt, runtime };
      }

      return runtime;
    })
    .finally(() => {
      inflightRead = undefined;
    });

  return inflightRead;
};

/**
 * Synchronous view for `getParamsFromPayload`, which must stay sync. `null`
 * means "no usable company configuration right now"; the caller decides
 * whether the env fallback or a readable error applies.
 */
export const getCompanyProviderRuntimeSnapshot = (): CompanyProviderRuntime | null =>
  cacheEntry?.runtime ?? null;

/** Refresh the snapshot without exposing a second cache to callers. */
export const warmCompanyProviderRuntime = async (
  db: LobeChatDatabase,
  options: CompanyProviderOptions = {},
): Promise<void> => {
  await getCompanyProviderRuntime(db, options);
};

/**
 * Runtime params for a tellhow request, resolved synchronously.
 *
 * Priority: the values in the payload (a caller that explicitly passes its own
 * endpoint + key, e.g. an admin-owned provider row) → the console config → the
 * `TELLHOW_*` deployment env. A user-supplied endpoint never receives the
 * company key: if the payload carries its own baseURL, only the payload's key
 * is used and a missing key stays missing.
 */
export const resolveCompanyProviderParams = (
  payload: { apiKey?: string; baseURL?: string },
  env: NodeJS.ProcessEnv = process.env,
): { apiKey?: string; baseURL?: string } | null => {
  if (payload.baseURL) return { apiKey: payload.apiKey, baseURL: payload.baseURL };
  if (payload.apiKey) return { apiKey: payload.apiKey };

  const company = getCompanyProviderRuntimeSnapshot();
  if (company) return { apiKey: company.apiKey, baseURL: company.baseURL };

  const apiKey = env.TELLHOW_API_KEY?.trim();
  const baseURL = env.TELLHOW_PROXY_URL?.trim();

  return apiKey && baseURL ? { apiKey, baseURL } : null;
};

/** The readable, typed error a disabled service returns instead of a 500. */
export const createCompanyProviderNotConfiguredError = () =>
  AgentRuntimeError.createError(AgentRuntimeErrorType.NoAvailableProvider, {
    message: COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE,
  });

/** Payload builder entry point: params, or the readable error — never a raw throw. */
export const resolveCompanyProviderParamsOrThrow = (
  payload: { apiKey?: string; baseURL?: string },
  env: NodeJS.ProcessEnv = process.env,
): { apiKey?: string; baseURL?: string } => {
  const params = resolveCompanyProviderParams(payload, env);
  if (!params) throw createCompanyProviderNotConfiguredError();

  return params;
};

/**
 * Warm the snapshot for providers whose credentials live outside the user row
 * (only tellhow does). Called from the async runtime initializer, before the
 * synchronous payload builder reads the cache.
 */
export const ensureCompanyProviderReady = async (
  provider: string,
  db: LobeChatDatabase,
  options: CompanyProviderOptions = {},
): Promise<void> => {
  if (provider !== COMPANY_PROVIDER_ID) return;

  await getCompanyProviderRuntime(db, options);
};

/** Catalog row → server model card. `enabled` is what makes it selectable. */
export const toCompanyModelCard = (
  model: CompanyModel,
): AiFullModelCard & { providerId: string } => {
  const capabilities = new Set(model.capabilities ?? []);

  return {
    abilities: {
      ...(capabilities.has('functionCall') ? { functionCall: true } : {}),
      ...(capabilities.has('reasoning') ? { reasoning: true } : {}),
      ...(capabilities.has('vision') ? { vision: true } : {}),
    },
    ...(model.contextWindowTokens ? { contextWindowTokens: model.contextWindowTokens } : {}),
    displayName: model.name,
    enabled: true,
    id: model.id,
    providerId: COMPANY_PROVIDER_ID,
    type: model.type,
  };
};

const getServerDatabase = async (): Promise<LobeChatDatabase | undefined> => {
  try {
    const { getServerDB } = await import('@lobechat/database');

    return await getServerDB();
  } catch (error) {
    // Nothing is configured yet on a fresh instance; the provider stays hidden.
    console.error('[companyProvider] server database unavailable:', error);
    return undefined;
  }
};

/**
 * Merge the console catalog into the server provider config (§5.3 / §5.4).
 *
 * The client derives provider visibility from `aiProvider[id].enabled` and the
 * model list from `serverModelLists`, so this is the only place the admin
 * configuration becomes user-visible. Disabled / unconfigured clears both, which
 * is what "关闭后立即不可见" means for the provider list.
 */
export const withCompanyProviderCatalog = async <T extends Record<string, ProviderConfig>>(
  providerConfigs: T,
  options: CompanyProviderOptions & { db?: LobeChatDatabase } = {},
): Promise<T> => {
  const db = options.db ?? (await getServerDatabase());
  const runtime = db ? await getCompanyProviderRuntime(db, options) : null;
  const current = providerConfigs[COMPANY_PROVIDER_ID];

  const companyConfig: ProviderConfig = runtime
    ? {
        ...current,
        enabled: true,
        enabledModels: runtime.models.map((model) => model.id),
        // Credentials live on the server; the browser must never hold them.
        fetchOnClient: false,
        serverModelLists: runtime.models.map(toCompanyModelCard),
      }
    : {
        ...current,
        enabled: false,
        enabledModels: [],
        fetchOnClient: false,
        serverModelLists: [],
      };

  return { ...providerConfigs, [COMPANY_PROVIDER_ID]: companyConfig };
};

/**
 * Per-call SSRF allowance for the one admin-configured gateway.
 *
 * Tellhow gateways are usually intranet addresses, so this call site opts into
 * private addresses for its own endpoint instead of flipping
 * `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1` for the whole process (which would also
 * loosen user-supplied provider endpoints). An IP literal is allow-listed
 * exactly; a hostname cannot be enumerated synchronously and keeps the
 * private-address allowance for this call alone.
 */
export const companyProviderSsrfOptions = (baseURL: string): SSRFOptions => {
  let hostname: string;
  try {
    hostname = new URL(baseURL).hostname.replaceAll(/^\[|\]$/g, '');
  } catch {
    return {};
  }

  return net.isIP(hostname) !== 0
    ? { allowIPAddressList: [hostname] }
    : { allowPrivateIPAddress: true };
};

/**
 * Single outbound entry point for the console side (connection test, catalog
 * sync): everything goes through `ssrfSafeFetch` with the allowance above.
 */
export const companyProviderFetch = (
  url: string,
  init?: RequestInit,
  runtime?: Pick<CompanyProviderRuntime, 'baseURL'>,
): Promise<Response> =>
  ssrfSafeFetch(url, init, companyProviderSsrfOptions(runtime?.baseURL ?? url));
