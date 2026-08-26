import * as vscode from "vscode";
import {
  readSettingWithFallback,
  SETTING_CONNECTION_NAME,
  SETTING_DELETE_REMOTE_ON_LOCAL_DELETE,
  SETTING_HOST,
  SETTING_IGNORE_PATTERNS,
  SETTING_LOCAL_SUBFOLDER,
  SETTING_PORT,
  SETTING_PRIVATE_KEY_PATH,
  SETTING_REMOTE_ROOT,
  SETTING_SSH_PASSWORD_AUTHENTICATION,
  SETTING_UPLOAD_ON_SAVE,
  SETTING_USERNAME,
} from "./configAliases";
import { logLine } from "./logger";
import {
  defaultConnectionParameters,
  isSyncRootEmpty,
  readSyncJsonRootFromDisk,
  sanitizeConnectionName,
  upsertConnectionInRoot,
  type ConnectionParameters,
} from "./syncJsonFile";

function readLegacyConnectionParameters(
  configuration: vscode.WorkspaceConfiguration
): ConnectionParameters {
  const defaults = defaultConnectionParameters();
  return {
    ...defaults,
    host: readSettingWithFallback(configuration, SETTING_HOST).trim(),
    port: readSettingWithFallback(configuration, SETTING_PORT),
    username: readSettingWithFallback(configuration, SETTING_USERNAME).trim(),
    sshPasswordAuthentication: readSettingWithFallback(
      configuration,
      SETTING_SSH_PASSWORD_AUTHENTICATION
    ),
    privateKeyPath: readSettingWithFallback(
      configuration,
      SETTING_PRIVATE_KEY_PATH
    ).trim(),
    remoteRoot: readSettingWithFallback(configuration, SETTING_REMOTE_ROOT).trim(),
    localSubfolder: readSettingWithFallback(
      configuration,
      SETTING_LOCAL_SUBFOLDER
    ).trim(),
    uploadOnSave: readSettingWithFallback(configuration, SETTING_UPLOAD_ON_SAVE),
    deleteRemoteOnLocalDelete: readSettingWithFallback(
      configuration,
      SETTING_DELETE_REMOTE_ON_LOCAL_DELETE
    ),
    ignorePatterns: [
      ...readSettingWithFallback(configuration, SETTING_IGNORE_PATTERNS),
    ],
  };
}

function hasLegacyConnectionData(parameters: ConnectionParameters): boolean {
  return (
    parameters.host.length > 0 ||
    parameters.username.length > 0 ||
    parameters.remoteRoot.length > 0 ||
    parameters.privateKeyPath.length > 0
  );
}

function resolveLegacyConnectionName(
  configuration: vscode.WorkspaceConfiguration
): string {
  const fromSettings = sanitizeConnectionName(
    readSettingWithFallback(configuration, SETTING_CONNECTION_NAME)
  );
  return fromSettings.length > 0 ? fromSettings : "Default";
}

/**
 * Migra uma única vez definições de conexão legadas (settings.json) para sync.jsonc.
 */
export function migrateLegacySettingsToSyncJsonc(
  workspaceFolder: vscode.WorkspaceFolder
): boolean {
  const root = readSyncJsonRootFromDisk(workspaceFolder);
  if (!isSyncRootEmpty(root)) {
    return false;
  }
  const configuration = vscode.workspace.getConfiguration(
    "sftpSync",
    workspaceFolder.uri
  );
  const parameters = readLegacyConnectionParameters(configuration);
  if (!hasLegacyConnectionData(parameters)) {
    return false;
  }
  const connectionName = resolveLegacyConnectionName(configuration);
  upsertConnectionInRoot(workspaceFolder, connectionName, parameters);
  logLine(
    `Definições legadas em settings.json migradas para sync.jsonc (conexão "${connectionName}").`
  );
  return true;
}

export function migrateAllWorkspaceLegacySettings(): void {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    migrateLegacySettingsToSyncJsonc(folder);
  }
}
