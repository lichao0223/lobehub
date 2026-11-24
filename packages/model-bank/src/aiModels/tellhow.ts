import type { AiFullModelCard } from '../types/aiModel';

/**
 * Tellhow's catalog starts empty on purpose: the administrator maintains the
 * model list in the admin console (`config.ai.models`) and the server merges it
 * into the provider's runtime model list, so it is never checked into code.
 */
export const tellhowModels: AiFullModelCard[] = [];

export default tellhowModels;
