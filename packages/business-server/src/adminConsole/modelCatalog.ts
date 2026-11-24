import type { LobeChatDatabase } from '@lobechat/database';
import type {
  AdminConsoleAiLastTest,
  AdminConsoleCatalogDiff,
  AdminConsoleCatalogSyncResult,
  AdminConsoleConnectionTestResult,
  AdminConsoleModelServiceConfig,
  CompanyModel,
  CompanyModelCapability,
} from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR, COMPANY_MODEL_CAPABILITIES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { AiFullModelCard, AiModelType } from 'model-bank';
import { AiModelTypeSchema, LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import type { CompanyProviderKeyDecryptor } from '../companyProvider';
import { companyProviderFetch, readCompanyProviderCredentials } from '../companyProvider';
import type { KeyVaultEncryptor } from './modelService';
import { createAdminConsoleModelService } from './modelService';

/**
 * Tellhow model-service connection test + catalog sync (CUST-008 §5.2 / §5.4 / §5.6).
 *
 * Two admin-only operations share one outbound probe of the OpenAI-compatible
 * `GET {baseURL}/models` endpoint:
 *
 * - `testConnection()` reports status / latency / model count / a stable error
 *   code and records the outcome in `config.ai.lastTest`;
 * - `refreshCatalog({ apply })` diffs the upstream ids against the stored
 *   catalog. `apply: false` is a dry run; `apply: true` writes through
 *   `AdminConsoleModelService.updateConfig` so validation and the
 *   `updatedAt` optimistic lock stay in one place.
 *
 * The sync never overwrites an administrator's decisions: `name`, `open` and
 * `type` of an existing row are left untouched, removals only stamp
 * `removedAt`, and new rows arrive closed (`open: false`) and `pending`. The
 * only automatic edits are clearing `removedAt` when upstream lists a model
 * again and filling metadata the row does not have yet.
 */

/** Default probe timeout. Long enough for a slow intranet gateway, short enough to fail fast. */
export const MODEL_SERVICE_TEST_TIMEOUT_MS = 10_000;

/** `/models` is small; cap the body so a broken gateway cannot stream without bound. */
export const MODEL_CATALOG_MAX_BODY_BYTES = 1024 * 1024;

/** Upstream only returns ids / owned_by / created (§5.4), so type comes from the name. */
const TYPE_RULES: ReadonlyArray<{ patterns: readonly string[]; type: AiModelType }> = [
  { patterns: ['embed', 'bge', 'gte', 'text-embedding'], type: 'embedding' },
  { patterns: ['music', 'suno', 'melody', 'text2music'], type: 'text2music' },
  { patterns: ['tts', 'speech', 'voice'], type: 'tts' },
  // Checked before the ASR row on purpose: `*-realtime-audio` is a realtime
  // model, not a transcription one, even though it contains `audio`.
  { patterns: ['realtime'], type: 'realtime' },
  { patterns: ['decision'], type: 'decision' },
  { patterns: ['whisper', 'asr', 'stt', 'transcribe', 'audio'], type: 'asr' },
  { patterns: ['dall-e', 'flux', 'diffusion', 'image', 'sd-'], type: 'image' },
  { patterns: ['video', 'sora', 'veo', 'kling'], type: 'video' },
];

/** The subset of a built-in model card the sync needs. */
export interface CatalogLookupModel {
  capabilities?: CompanyModelCapability[];
  contextWindowTokens?: number;
  /** Display name from the repo catalog, used only for newly added models. */
  name?: string;
  /** `AiModelType` of the known card, used when the name rule cannot decide. */
  type?: string;
}

export type CatalogModelLookup = (modelId: string) => CatalogLookupModel | undefined;

/** Structural fetch seam: production uses `companyProviderFetch` (ssrfSafeFetch). */
export type CompanyModelsFetcher = (
  url: string,
  init: RequestInit,
  baseURL: string,
) => Promise<Response>;

/**
 * Everything the catalog needs from storage. The default implementation wraps
 * `AdminConsoleModelService` + `readCompanyProviderCredentials`; tests pass an
 * in-memory version to exercise diffs without a database.
 */
export interface ModelCatalogConfigStore {
  readConfig: () => Promise<AdminConsoleModelServiceConfig>;
  /** `null` when no address is stored; `apiKey: null` when the key is missing. */
  readCredentials: () => Promise<{ apiKey: string | null; baseURL: string } | null>;
  recordTest: (test: AdminConsoleAiLastTest) => Promise<unknown>;
  updateModels: (
    models: CompanyModel[],
    expectedUpdatedAt: string,
  ) => Promise<AdminConsoleModelServiceConfig>;
}

export interface AdminConsoleModelCatalogServiceOptions {
  fetch?: CompanyModelsFetcher;
  /** Structural decryptor for `config.ai.apiKey`; tests avoid `KEY_VAULTS_SECRET`. */
  gatekeeper?: CompanyProviderKeyDecryptor & KeyVaultEncryptor;
  /** Built-in catalog lookup; defaults to `LOBE_DEFAULT_MODEL_LIST`. */
  lookup?: CatalogModelLookup;
  /** Millisecond clock, injected for deterministic latency assertions. */
  now?: () => number;
  /** Storage seam; defaults to the settings row + KeyVaults gatekeeper. */
  store?: ModelCatalogConfigStore;
  /** Overrides `MODEL_SERVICE_TEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** `{baseURL}/models`, tolerant of a trailing slash or an address that already ends in `/models`. */
export const buildModelsUrl = (baseURL: string): string => {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/models') ? trimmed : `${trimmed}/models`;
};

/**
 * Extract the ids from an OpenAI-compatible model list. Accepts `{ data: [] }`
 * (OpenAI), `{ models: [] }` (some gateways) and a bare array. Returns `null`
 * for a shape we cannot read, which is the "parse failure" error path.
 */
export const extractUpstreamModelIds = (payload: unknown): string[] | null => {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as { data?: unknown; models?: unknown }).data ??
        (payload as { models?: unknown }).models)
      : undefined;

  if (!Array.isArray(list)) return null;

  const ids = new Set<string>();
  for (const item of list) {
    const id =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? (item as { id?: unknown }).id
          : undefined;
    if (typeof id === 'string' && id.trim()) ids.add(id.trim());
  }

  return [...ids];
};

/**
 * Infer the model type from its id using the §5.4 table.
 *
 * `confident: false` means no rule matched and the caller fell back to the
 * default `chat`: the sync reports those ids in `needsReview`.
 */
export const inferCompanyModelType = (
  modelId: string,
): { confident: boolean; type: AiModelType } => {
  const id = modelId.trim().toLowerCase();

  for (const rule of TYPE_RULES) {
    if (rule.patterns.some((pattern) => id.includes(pattern))) {
      return { confident: true, type: rule.type };
    }
  }

  return { confident: false, type: 'chat' };
};

/**
 * Rule inference first; a known built-in card supplies the type when the name
 * is not conclusive. Anything still unknown stays `chat` and needs review.
 */
export const resolveCompanyModelType = (
  modelId: string,
  lookup?: CatalogModelLookup,
): { confident: boolean; type: AiModelType } => {
  const inferred = inferCompanyModelType(modelId);
  if (inferred.confident) return inferred;

  const builtinType = lookup?.(modelId)?.type;
  const parsed = builtinType ? AiModelTypeSchema.safeParse(builtinType) : undefined;
  if (parsed?.success) return { confident: true, type: parsed.data };

  return inferred;
};

/** Fill only what the row does not have: never overwrite an administrator's edit. */
const enrichModelMetadata = (model: CompanyModel, lookup?: CatalogModelLookup): CompanyModel => {
  const known = lookup?.(model.id);
  if (!known) return model;

  let next = model;
  if (next.contextWindowTokens === undefined && known.contextWindowTokens) {
    next = { ...next, contextWindowTokens: known.contextWindowTokens };
  }
  if (next.capabilities === undefined && known.capabilities?.length) {
    next = { ...next, capabilities: [...known.capabilities] };
  }

  return next;
};

export interface DiffModelCatalogOptions {
  lookup?: CatalogModelLookup;
  /** Clock for `removedAt`; injected for stable tests. */
  now?: () => Date;
}

/**
 * Diff the stored catalog against the upstream ids.
 *
 * Existing rows keep `name` / `open` / `type` verbatim. New rows are closed
 * (`open: false`, `pending: true`, `source: 'sync'`) and are appended in
 * upstream order after the stored rows. A sync-sourced row that disappeared is
 * kept with `removedAt` rather than deleted; a manual row uses a custom id or
 * alias upstream may not list, so it is never marked removed automatically.
 */
export const diffModelCatalog = (
  current: readonly CompanyModel[],
  upstreamIds: readonly string[],
  options: DiffModelCatalogOptions = {},
): { diff: AdminConsoleCatalogDiff; models: CompanyModel[] } => {
  const removedAt = (options.now?.() ?? new Date()).toISOString();
  const upstream = new Set(upstreamIds);
  const currentById = new Map(current.map((model) => [model.id, model]));

  const diff: AdminConsoleCatalogDiff = {
    added: [],
    needsReview: [],
    removed: [],
    restored: [],
    unchanged: [],
    updated: [],
  };
  const models: CompanyModel[] = [];

  for (const model of current) {
    if (!upstream.has(model.id)) {
      if (model.source === 'sync' && !model.removedAt) {
        const removed: CompanyModel = { ...model, removedAt };
        diff.removed.push(removed);
        models.push(removed);
      } else {
        models.push(model);
      }
      continue;
    }

    let next = model;
    let changed = false;

    if (model.removedAt) {
      const { removedAt: _removedAt, ...rest } = model;
      next = rest;
      changed = true;
      diff.restored.push(next);
    }

    const enriched = enrichModelMetadata(next, options.lookup);
    if (enriched !== next) {
      next = enriched;
      changed = true;
      diff.updated.push(next);
    }

    if (!changed) diff.unchanged.push(model.id);
    models.push(next);
  }

  for (const id of upstreamIds) {
    if (currentById.has(id)) continue;

    const known = options.lookup?.(id);
    const resolved = resolveCompanyModelType(id, options.lookup);

    diff.added.push({
      ...(known?.capabilities?.length ? { capabilities: [...known.capabilities] } : {}),
      ...(known?.contextWindowTokens ? { contextWindowTokens: known.contextWindowTokens } : {}),
      id,
      name: known?.name?.trim() || id,
      open: false,
      pending: true,
      source: 'sync',
      type: resolved.type,
    });
    if (!resolved.confident) diff.needsReview.push(id);

    models.push(diff.added.at(-1)!);
  }

  return { diff, models };
};

let builtinLookup: CatalogModelLookup | undefined;

const toLookupModel = (card: AiFullModelCard): CatalogLookupModel => {
  const capabilities = COMPANY_MODEL_CAPABILITIES.filter(
    (capability) => card.abilities?.[capability] === true,
  );

  return {
    ...(capabilities.length ? { capabilities } : {}),
    ...(card.contextWindowTokens ? { contextWindowTokens: card.contextWindowTokens } : {}),
    ...(card.displayName ? { name: card.displayName } : {}),
    type: card.type,
  };
};

/** Built-in catalog index, built once per process and keyed case-insensitively. */
export const getDefaultCatalogLookup = (): CatalogModelLookup => {
  if (!builtinLookup) {
    const index = new Map<string, CatalogLookupModel>();
    for (const card of LOBE_DEFAULT_MODEL_LIST) {
      const key = card.id.toLowerCase();
      if (!index.has(key)) index.set(key, toLookupModel(card));
    }
    builtinLookup = (modelId) => index.get(modelId.trim().toLowerCase());
  }

  return builtinLookup;
};

const createConfigStore = (
  db: LobeChatDatabase,
  actingUserId: string,
  options: AdminConsoleModelCatalogServiceOptions,
): ModelCatalogConfigStore => {
  const service = createAdminConsoleModelService(db, actingUserId, {
    gatekeeper: options.gatekeeper,
  });

  return {
    readConfig: () => service.getConfig(),
    readCredentials: async () => {
      const credentials = await readCompanyProviderCredentials(db, {
        gatekeeper: options.gatekeeper,
      });
      if (!credentials) return null;

      return { apiKey: credentials.apiKey, baseURL: credentials.baseURL };
    },
    recordTest: (test) => service.recordLastTest(test),
    updateModels: async (models, expectedUpdatedAt) => {
      // Keep whatever the admin saved for `enabled`: the sync only owns the
      // catalog, and `updateConfig` requires the final `enabled` it sees.
      const current = await service.getConfig();

      return service.updateConfig({
        enabled: current.config.enabled,
        expectedUpdatedAt,
        models,
      });
    },
  };
};

const conflict = () =>
  new TRPCError({ code: 'CONFLICT', message: ADMIN_CONSOLE_ERROR.configConflict });

const upstreamError = (errorCode: string) =>
  new TRPCError({
    code: errorCode === ADMIN_CONSOLE_ERROR.providerNotConfigured ? 'BAD_REQUEST' : 'BAD_GATEWAY',
    message: errorCode,
  });

type ProbeResult =
  | { ids: string[]; latencyMs: number; ok: true }
  | { errorCode: string; latencyMs?: number; ok: false };

const discardBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already gone; nothing to release.
  }
};

export class AdminConsoleModelCatalogService {
  private readonly fetcher: CompanyModelsFetcher;
  private readonly lookup: CatalogModelLookup;
  private readonly now: () => number;
  private readonly store: ModelCatalogConfigStore;
  private readonly timeoutMs: number;

  constructor(
    db: LobeChatDatabase,
    actingUserId: string,
    options: AdminConsoleModelCatalogServiceOptions = {},
  ) {
    this.store = options.store ?? createConfigStore(db, actingUserId, options);
    this.fetcher =
      options.fetch ??
      ((url, init, baseURL) =>
        companyProviderFetch(
          url,
          init,
          { baseURL },
          {
            maxContentLength: MODEL_CATALOG_MAX_BODY_BYTES,
          },
        ));
    this.lookup = options.lookup ?? getDefaultCatalogLookup();
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? MODEL_SERVICE_TEST_TIMEOUT_MS;
  }

  /**
   * Probe the saved endpoint with the saved key. Works while the service is
   * still disabled, because enabling it is exactly what an admin is deciding.
   */
  testConnection = async (): Promise<AdminConsoleConnectionTestResult> => {
    let credentials: { apiKey: string | null; baseURL: string } | null;
    try {
      credentials = await this.store.readCredentials();
    } catch (error) {
      // The stored key cannot be decrypted (rotated KEY_VAULTS_SECRET): it is
      // unusable for authentication until the admin pastes a new one.
      console.error('[adminConsole] failed to read the Tellhow credentials:', error);
      return { errorCode: ADMIN_CONSOLE_ERROR.providerAuthFailed, ok: false };
    }

    if (!credentials?.baseURL || !credentials.apiKey) {
      return { errorCode: ADMIN_CONSOLE_ERROR.providerNotConfigured, ok: false };
    }

    const probe = await this.probe(credentials.baseURL, credentials.apiKey);
    const result: AdminConsoleConnectionTestResult = probe.ok
      ? { latencyMs: probe.latencyMs, modelCount: probe.ids.length, ok: true }
      : {
          ...(probe.latencyMs === undefined ? {} : { latencyMs: probe.latencyMs }),
          errorCode: probe.errorCode,
          ok: false,
        };

    await this.recordTest(result);

    return result;
  };

  /**
   * Diff the stored catalog against upstream. `apply: false` never writes;
   * `apply: true` writes only when something actually changed, so repeated
   * syncs are idempotent and do not bump `updatedAt`.
   */
  refreshCatalog = async (input: {
    apply: boolean;
    /** Row version the admin read; defaults to the version read by this call. */
    expectedUpdatedAt?: string;
  }): Promise<AdminConsoleCatalogSyncResult> => {
    let credentials: { apiKey: string | null; baseURL: string } | null;
    try {
      credentials = await this.store.readCredentials();
    } catch (error) {
      console.error('[adminConsole] failed to read the Tellhow credentials:', error);
      throw upstreamError(ADMIN_CONSOLE_ERROR.providerAuthFailed);
    }

    if (!credentials?.baseURL || !credentials.apiKey) {
      throw upstreamError(ADMIN_CONSOLE_ERROR.providerNotConfigured);
    }

    const probe = await this.probe(credentials.baseURL, credentials.apiKey);
    if (!probe.ok) throw upstreamError(probe.errorCode);

    const current = await this.store.readConfig();
    const { diff, models } = diffModelCatalog(current.config.models, probe.ids, {
      lookup: this.lookup,
      now: () => new Date(this.now()),
    });

    const changed =
      diff.added.length + diff.removed.length + diff.restored.length + diff.updated.length > 0;

    if (!input.apply || !changed) {
      return {
        applied: false,
        diff,
        updatedAt: current.updatedAt,
        upstreamModelCount: probe.ids.length,
      };
    }

    // Pass the version read above so a concurrent save conflicts instead of
    // being overwritten; an explicit version from the page wins.
    const expectedUpdatedAt = input.expectedUpdatedAt ?? current.updatedAt;
    if (!expectedUpdatedAt) throw conflict();

    const written = await this.store.updateModels(models, expectedUpdatedAt);

    return {
      applied: true,
      diff,
      updatedAt: written.updatedAt,
      upstreamModelCount: probe.ids.length,
    };
  };

  private recordTest = async (result: AdminConsoleConnectionTestResult): Promise<void> => {
    try {
      await this.store.recordTest({
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
        ...(result.modelCount === undefined ? {} : { modelCount: result.modelCount }),
        at: new Date(this.now()).toISOString(),
        ok: result.ok,
      });
    } catch (error) {
      // Failing to persist the outcome must not hide the outcome itself.
      console.error('[adminConsole] failed to record the connection test:', error);
    }
  };

  private probe = async (baseURL: string, apiKey: string): Promise<ProbeResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = this.now();
    const latency = () => Math.max(0, Math.round(this.now() - startedAt));

    try {
      const response = await this.fetcher(
        buildModelsUrl(baseURL),
        {
          headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
          method: 'GET',
          signal: controller.signal,
        },
        baseURL,
      );

      if (response.status === 401 || response.status === 403) {
        await discardBody(response);
        return {
          errorCode: ADMIN_CONSOLE_ERROR.providerAuthFailed,
          latencyMs: latency(),
          ok: false,
        };
      }

      if (!response.ok) {
        await discardBody(response);
        return {
          errorCode: ADMIN_CONSOLE_ERROR.providerHttpError,
          latencyMs: latency(),
          ok: false,
        };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          errorCode: ADMIN_CONSOLE_ERROR.providerInvalidResponse,
          latencyMs: latency(),
          ok: false,
        };
      }

      const ids = extractUpstreamModelIds(payload);
      if (!ids) {
        return {
          errorCode: ADMIN_CONSOLE_ERROR.providerInvalidResponse,
          latencyMs: latency(),
          ok: false,
        };
      }

      return { ids, latencyMs: latency(), ok: true };
    } catch (error) {
      // A timeout is the abort we scheduled; everything else is transport
      // (DNS, connect, TLS, SSRF policy) and reads as unreachable.
      if (controller.signal.aborted) {
        return { errorCode: ADMIN_CONSOLE_ERROR.providerTimeout, ok: false };
      }

      console.error('[adminConsole] Tellhow /models probe failed:', error);

      return {
        errorCode: ADMIN_CONSOLE_ERROR.providerUnreachable,
        latencyMs: latency(),
        ok: false,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export const createAdminConsoleModelCatalogService = (
  db: LobeChatDatabase,
  actingUserId: string,
  options?: AdminConsoleModelCatalogServiceOptions,
) => new AdminConsoleModelCatalogService(db, actingUserId, options);
