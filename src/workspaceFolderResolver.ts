import * as vscode from "vscode";

/**
 * Pasta de workspace que contém o caminho absoluto (multi-root).
 */
export function resolveWorkspaceFolderForAbsolutePath(
  absolutePath: string
): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(absolutePath)
  );
}

/**
 * Primeira pasta aberta (fallback quando não há URI associada).
 */
export function getPrimaryWorkspaceFolder():
  | vscode.WorkspaceFolder
  | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0];
}

/**
 * Resolve pasta pelo URI do documento/recurso ou usa a primeira pasta.
 */
export function resolveWorkspaceFolder(
  resourceUri?: vscode.Uri
): vscode.WorkspaceFolder | undefined {
  if (resourceUri) {
    const match = vscode.workspace.getWorkspaceFolder(resourceUri);
    if (match) {
      return match;
    }
  }
  return getPrimaryWorkspaceFolder();
}

export function buildConnectionPoolKey(
  workspaceFolder: vscode.WorkspaceFolder,
  connectionName: string
): string {
  const workspaceKey = workspaceFolder.uri.toString();
  const name = connectionName.trim() || "default";
  return `${workspaceKey}::${name}`;
}
