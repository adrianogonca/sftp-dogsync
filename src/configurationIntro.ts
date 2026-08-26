import * as vscode from "vscode";
import { INTRO_COMPLETED_KEY_LEGACY } from "./configAliases";
import {
  isMinimumConfigurationFilled,
  isConfigurationCompletelyEmpty,
  readConfiguration,
} from "./configuration";
import { getPrimaryWorkspaceFolder } from "./workspaceFolderResolver";

const INTRO_COMPLETED_KEY = "sftpSync.configurationIntroCompleted";

function isIntroCompleted(context: vscode.ExtensionContext): boolean {
  const englishValue = context.workspaceState.get<boolean>(INTRO_COMPLETED_KEY);
  if (englishValue !== undefined) {
    return englishValue === true;
  }
  return context.workspaceState.get<boolean>(INTRO_COMPLETED_KEY_LEGACY) === true;
}

/**
 * Se a ligação já está completa, marca o passo inicial como feito.
 */
export function synchronizeConfigurationIntroState(
  context: vscode.ExtensionContext
): void {
  const folder = getPrimaryWorkspaceFolder();
  if (!folder) {
    return;
  }
  if (isConfigurationCompletelyEmpty(folder)) {
    void context.workspaceState.update(INTRO_COMPLETED_KEY, false);
    return;
  }
  const configuration = readConfiguration(folder);
  if (isMinimumConfigurationFilled(configuration)) {
    void context.workspaceState.update(INTRO_COMPLETED_KEY, true);
  }
}

/**
 * Ecrã inicial «Configurar» (painel): só quando não há conexões em sync.jsonc/sync.json.
 */
export function shouldShowConfigureOnly(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder
): boolean {
  const configuration = readConfiguration(workspaceFolder);
  if (isMinimumConfigurationFilled(configuration)) {
    return false;
  }
  if (isConfigurationCompletelyEmpty(workspaceFolder)) {
    return true;
  }
  return isIntroCompleted(context) !== true;
}

export function markConfigurationIntroCompleted(
  context: vscode.ExtensionContext
): Thenable<void> {
  return context.workspaceState.update(INTRO_COMPLETED_KEY, true);
}
