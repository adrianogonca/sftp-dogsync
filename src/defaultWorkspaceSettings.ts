import * as vscode from "vscode";
import {
  openSyncJsonFileInEditor,
  moveConnectionToFirstInSyncRoot,
  defaultConnectionParameters,
  sanitizeConnectionName,
  upsertConnectionInRoot,
} from "./syncJsonFile";

/**
 * Cria ou substitui uma entrada na raiz de `.vscode/sync.jsonc` e abre o ficheiro para edição.
 */
export async function createConnectionWithDefaultsAndOpenEditor(
  workspaceFolder: vscode.WorkspaceFolder,
  connectionName: string
): Promise<void> {
  const name = sanitizeConnectionName(connectionName);
  upsertConnectionInRoot(workspaceFolder, name, defaultConnectionParameters());
  moveConnectionToFirstInSyncRoot(workspaceFolder, name);
  await openSyncJsonFileInEditor(workspaceFolder);
}
