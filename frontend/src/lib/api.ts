/** Stable API facade; domain functions share the session transport. */

import * as prompts from './api/prompts';
import * as oauth from './api/oauth';
import * as accounts from './api/accounts';
import * as refinement from './api/refinement';
export { ApiError, PROMPT_NOT_FOUND_MESSAGE, isValidPromptId } from './api/errors';

export class ApiClient {
  static getRefinementQuestions = refinement.getRefinementQuestions;
  static createRefinementDraft = refinement.createRefinementDraft;
  static createPrompt = prompts.createPrompt;
  static getSavedPrompts = prompts.getSavedPrompts;
  static renameFolder = prompts.renameFolder;
  static removeFolder = prompts.removeFolder;
  static getFolders = prompts.getFolders;
  static updatePrompt = prompts.updatePrompt;
  static deletePrompt = prompts.deletePrompt;
  static flushDeletePrompt = prompts.flushDeletePrompt;
  static getPromptById = prompts.getPromptById;
  static parsePromptText = prompts.parsePromptText;
  static getPromptsConfig = prompts.getPromptsConfig;
  static duplicatePrompt = prompts.duplicatePrompt;
  static getPromptVersions = prompts.getPromptVersions;
  static restorePromptVersion = prompts.restorePromptVersion;
  static exportPrompts = prompts.exportPrompts;
  static getOAuthConsent = oauth.getOAuthConsent;
  static decideOAuthConsent = oauth.decideOAuthConsent;
  static deleteAccount = accounts.deleteAccount;
}
