import type { AiProviderListItem } from '@lobechat/types';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

const userId = 'test-user-id';
const mockProviderConfigs = {
  openai: { enabled: true },
  anthropic: { enabled: false },
};

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs);
});

describe('AiInfraRepos', () => {
  describe('getAiProviderList', () => {
    it('should merge builtin and user providers correctly', async () => {
      const mockUserProviders = [
        { id: 'openai', enabled: true, name: 'Custom OpenAI' },
        { id: 'custom', enabled: true, name: 'Custom Provider' },
      ] as AiProviderListItem[];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValueOnce(mockUserProviders);

      const result = await repo.getAiProviderList();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // Verify the merge logic
      const openaiProvider = result.find((p) => p.id === 'openai');
      expect(openaiProvider).toMatchObject({ enabled: true, name: 'Custom OpenAI' });
    });

    it('should sort providers according to DEFAULT_MODEL_PROVIDER_LIST order', async () => {
      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValue([]);

      const result = await repo.getAiProviderList();

      expect(result).toEqual(
        expect.arrayContaining(
          DEFAULT_MODEL_PROVIDER_LIST.map((item) =>
            expect.objectContaining({
              id: item.id,
              source: 'builtin',
            }),
          ),
        ),
      );
    });

    // CUST-011-C: `getAiProviderSpecificConfig()` ships
    // `{ tellhow: enabled, ...everyoneElse: disabled }`. These three cases are
    // the whole contract of that default: it seeds a new user's switches, the
    // user's own row ORs over it, and the admin console still decides whether
    // Tellhow exists at all.
    describe('CUST-011-C defaults (default-off is not forbidden)', () => {
      const forkProviderConfigs = {
        deepseek: { enabled: false },
        openai: { enabled: false },
        tellhow: { enabled: true },
      };

      it('should leave only Tellhow enabled for a user who never touched a provider', async () => {
        const forkRepo = new AiInfraRepos(serverDB, userId, forkProviderConfigs);
        vi.spyOn(forkRepo.aiProviderModel, 'getAiProviderList').mockResolvedValue([]);

        const result = await forkRepo.getAiProviderList();

        expect(
          result.filter((provider) => provider.enabled).map((provider) => provider.id),
        ).toEqual(['tellhow']);
      });

      it('should keep a provider the user switched on even though its default is off', async () => {
        const forkRepo = new AiInfraRepos(serverDB, userId, forkProviderConfigs);
        vi.spyOn(forkRepo.aiProviderModel, 'getAiProviderList').mockResolvedValue([
          { enabled: true, id: 'openai', name: 'OpenAI' } as AiProviderListItem,
        ]);

        const result = await forkRepo.getAiProviderList();

        expect(result.find((provider) => provider.id === 'openai')).toMatchObject({
          enabled: true,
        });
      });

      it('should make Tellhow invisible when the administrator turned it off', async () => {
        const forkRepo = new AiInfraRepos(serverDB, userId, {
          ...forkProviderConfigs,
          tellhow: { enabled: false },
        });
        vi.spyOn(forkRepo.aiProviderModel, 'getAiProviderList').mockResolvedValue([]);

        const result = await forkRepo.getAiProviderList();

        expect(result.find((provider) => provider.id === 'tellhow')).toMatchObject({
          enabled: false,
        });
      });
    });
  });
});
