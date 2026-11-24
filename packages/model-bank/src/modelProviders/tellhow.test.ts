import { describe, expect, it } from 'vitest';

import { ModelProvider } from '../const/modelProvider';
import {
  DEFAULT_MODEL_PROVIDER_LIST,
  getProviderDisplayName,
  isProviderDisableBrowserRequest,
  TellhowProviderCard as ExportedCard,
} from './index';
import TellhowProviderCard from './tellhow';

describe('Tellhow provider', () => {
  it('is registered as a built-in provider under the tellhow id', () => {
    expect(ModelProvider.Tellhow).toBe('tellhow');
    expect(ExportedCard).toBe(TellhowProviderCard);
    expect(DEFAULT_MODEL_PROVIDER_LIST.filter((card) => card.id === 'tellhow')).toEqual([
      TellhowProviderCard,
    ]);
    expect(getProviderDisplayName('tellhow')).toBe('Tellhow AI');
  });

  it('names itself with plain brand copy, like the other built-in cards', () => {
    expect(TellhowProviderCard.name).toBe('Tellhow AI');
    expect(TellhowProviderCard.description).toBe('Enterprise built-in model service');
  });

  it('hides credentials, endpoint and client-side relay from end users', () => {
    expect(TellhowProviderCard).toMatchObject({
      chatModels: [],
      disableBrowserRequest: true,
      enabled: true,
      id: 'tellhow',
      name: 'Tellhow AI',
      proxyUrl: false,
      showApiKey: false,
      showChecker: false,
      showConfig: false,
      url: '',
    });
    expect(TellhowProviderCard.description).toBeTruthy();
    expect(TellhowProviderCard.settings).toMatchObject({
      disableBrowserRequest: true,
      modelEditable: false,
      proxyUrl: false,
      sdkType: 'openai',
      showAddNewModel: false,
      showApiKey: false,
      showChecker: false,
      showModelFetcher: false,
    });
    // Company credentials never leave the server.
    expect(isProviderDisableBrowserRequest('tellhow')).toBe(true);
  });
});
