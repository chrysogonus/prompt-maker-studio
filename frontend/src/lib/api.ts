/** Stable API facade; domain functions share the session transport. */

import * as prompts from './api/prompts';
import * as oauth from './api/oauth';
import * as accounts from './api/accounts';
import * as refinement from './api/refinement';
import * as evaluation from './api/evaluation';
import * as publicTools from './api/public';
export { ApiError, PROMPT_NOT_FOUND_MESSAGE, isValidPromptId } from './api/errors';
export type { BudgetErrorDetails } from './api/errors';
export type { PublicModelPrice } from './api/public';

export class ApiClient {
  static getPublicModelPrices = publicTools.getPublicModelPrices;
  static getPublicRefineStatus = publicTools.getPublicRefineStatus;
  static getPublicRefineQuestions = publicTools.getPublicRefineQuestions;
  static createPublicRefineDraft = publicTools.createPublicRefineDraft;
  static tryPrompt = prompts.tryPrompt;
  static getEvalCases = evaluation.getEvalCases;
  static createEvalCase = evaluation.createEvalCase;
  static updateEvalCase = evaluation.updateEvalCase;
  static deleteEvalCase = evaluation.deleteEvalCase;
  static importEvalCases = evaluation.importEvalCases;
  static exportEvalCases = evaluation.exportEvalCases;
  static generateEvalCases = evaluation.generateEvalCases;
  static runEvaluation = evaluation.runEvaluation;
  static getEvalRuns = evaluation.getEvalRuns;
  static rateEvalResult = evaluation.rateEvalResult;
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
