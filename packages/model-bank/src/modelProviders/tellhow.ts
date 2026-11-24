import type { ModelProviderCard } from '../types';

/**
 * The enterprise built-in Tellhow provider.
 *
 * Its endpoint, credentials and model catalog are owned by the administrator in
 * the admin console and injected on the server at request time. End users must
 * never see or edit them, so every client-side configuration surface is turned
 * off here: `showConfig` hides the whole form, `proxyUrl: false` removes the
 * endpoint field and `showApiKey: false` removes the API key field even if the
 * form is rendered by another host. `disableBrowserRequest` keeps requests on
 * the server, where the injected credentials live.
 *
 * `name` and `description` are plain strings, like every other built-in card
 * (`openai.ts`, `deepseek.ts`): provider names are brand copy, not locale keys,
 * so resolving them needs no extra i18n plumbing in settings or model surfaces.
 */
const Tellhow: ModelProviderCard = {
  chatModels: [],
  description: 'Enterprise built-in model service',
  disableBrowserRequest: true,
  enabled: true,
  id: 'tellhow',
  name: 'Tellhow AI',
  proxyUrl: false,
  settings: {
    disableBrowserRequest: true,
    modelEditable: false,
    proxyUrl: false,
    sdkType: 'openai',
    showAddNewModel: false,
    showApiKey: false,
    showChecker: false,
    showModelFetcher: false,
  },
  showApiKey: false,
  showChecker: false,
  showConfig: false,
  url: '',
};

export default Tellhow;
