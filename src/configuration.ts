import * as vscode from "vscode";
import * as path from "path";
import { readSettingWithFallback, SETTING_ENABLED } from "./configAliases";
import {
  readSyncJsonStructureFromDisk,
  readSyncJsonRootFromDisk,
  listConnectionNames,
  getFirstConnectionNameInDeclaredOrder,
  defaultConnectionParameters,
  ConnectionParameters,
  FtpSecurityMode,
  RemoteProtocol,
  isSyncRootEmpty,
} from "./syncJsonFile";

/**
 * Configuração de ligação e sincronização (extensão ativa + parâmetros da conexão ativa).
 */
export interface SftpConfiguration {
  readonly enabled: boolean;
  readonly connectionName: string;
  readonly protocol: RemoteProtocol;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly ftpSecurityMode: FtpSecurityMode;
  readonly trustFtpSelfSignedCertificate: boolean;
  readonly sshPasswordAuthentication: boolean;
  readonly privateKeyPath: string;
  readonly remoteRoot: string;
  readonly localSubfolder: string;
  readonly uploadOnSave: boolean;
  readonly deleteRemoteOnLocalDelete: boolean;
  readonly ignorePatterns: readonly string[];
  readonly useSshAgent: boolean;
  readonly strictHostKeyChecking: boolean;
  readonly knownHostsPath: string;
}

function normalizeRemoteSlash(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Remove esquemas (ftp://, ftps://, sftp://, ssh://) e caminhos após o host, para o
 * valor servir de hostname em clientes FTP/SSH.
 */
function normalizeRemoteHostHostname(
  protocol: RemoteProtocol,
  rawHost: string
): string {
  let s = rawHost.trim();
  if (s.length === 0) {
    return "";
  }
  const lowered = s.toLowerCase();
  if (protocol === "ftp") {
    if (lowered.startsWith("ftp://")) {
      s = s.slice(6);
    } else if (lowered.startsWith("ftps://")) {
      s = s.slice(7);
    }
  } else {
    if (lowered.startsWith("sftp://")) {
      s = s.slice(7);
    } else if (lowered.startsWith("ssh://")) {
      s = s.slice(6);
    }
  }
  s = s.trim();
  const beforeSlash = (s.split("/")[0] ?? s).trim();
  const authorityParts = beforeSlash.split("@");
  const hostPort =
    authorityParts.length > 1
      ? authorityParts[authorityParts.length - 1]
      : beforeSlash;
  return hostPort.trim();
}

function parametersToConfiguration(
  parameters: ConnectionParameters,
  connectionName: string,
  extensionEnabled: boolean
): SftpConfiguration {
  const protocol: RemoteProtocol =
    parameters.protocol === "ftp" ? "ftp" : "sftp";
  let remoteRoot = normalizeRemoteSlash(parameters.remoteRoot);
  if (protocol === "ftp" && remoteRoot.length === 0) {
    remoteRoot = "/";
  }
  return {
    enabled: extensionEnabled,
    connectionName,
    protocol,
    host: normalizeRemoteHostHostname(
      protocol,
      parameters.host
    ),
    port: parameters.port,
    username: parameters.username.trim(),
    ftpSecurityMode:
      parameters.ftpSecurityMode === "plainFtp"
        ? "plainFtp"
        : "explicitFtps",
    trustFtpSelfSignedCertificate: Boolean(
      parameters.trustFtpSelfSignedCertificate
    ),
    sshPasswordAuthentication: Boolean(
      parameters.sshPasswordAuthentication
    ),
    privateKeyPath: parameters.privateKeyPath.trim(),
    remoteRoot,
    localSubfolder: parameters.localSubfolder.trim(),
    uploadOnSave: parameters.uploadOnSave,
    deleteRemoteOnLocalDelete: Boolean(
      parameters.deleteRemoteOnLocalDelete
    ),
    ignorePatterns: [...(parameters.ignorePatterns ?? [])],
    useSshAgent: Boolean(parameters.useSshAgent),
    strictHostKeyChecking: Boolean(parameters.strictHostKeyChecking),
    knownHostsPath: (parameters.knownHostsPath ?? "").trim(),
  };
}

export function readExtensionEnabled(
  workspaceFolder: vscode.WorkspaceFolder
): boolean {
  const configuration = vscode.workspace.getConfiguration(
    "sftpSync",
    workspaceFolder.uri
  );
  return readSettingWithFallback(configuration, SETTING_ENABLED);
}

/**
 * Lê a conexão ativa a partir de `.vscode/sync.jsonc` (ou `sync.json` legado).
 * A primeira entrada no JSON é a conexão padrão. Só `sftpSync.enabled` vem de settings.json.
 */
export function readConfiguration(
  workspaceFolder: vscode.WorkspaceFolder
): SftpConfiguration {
  const extensionEnabled = readExtensionEnabled(workspaceFolder);
  const readResult = readSyncJsonStructureFromDisk(workspaceFolder);
  const root = readResult.connections;
  const names = listConnectionNames(root);

  if (!isSyncRootEmpty(root) && names.length > 0) {
    const chosenName = getFirstConnectionNameInDeclaredOrder(root);
    const blocks = root[chosenName];
    const first =
      Array.isArray(blocks) && blocks.length > 0
        ? blocks[0]
        : defaultConnectionParameters();
    return parametersToConfiguration(
      { ...defaultConnectionParameters(), ...first },
      chosenName,
      extensionEnabled
    );
  }

  return parametersToConfiguration(
    defaultConnectionParameters(),
    "",
    extensionEnabled
  );
}

/**
 * Lê parâmetros de uma conexão nomeada no ficheiro de sync (ignora resolução de conexão padrão).
 */
export function readConfigurationForConnectionName(
  workspaceFolder: vscode.WorkspaceFolder,
  connectionName: string
): SftpConfiguration | null {
  const name = connectionName.trim();
  if (name.length === 0) {
    return null;
  }
  const extensionEnabled = readExtensionEnabled(workspaceFolder);
  const readResult = readSyncJsonStructureFromDisk(workspaceFolder);
  const blocks = readResult.connections[name];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }
  const first = blocks[0];
  return parametersToConfiguration(
    { ...defaultConnectionParameters(), ...first },
    name,
    extensionEnabled
  );
}

/**
 * Resolve a raiz local absoluta (pasta do projeto ou subpasta configurada).
 */
export function resolveAbsoluteLocalRoot(
  workspaceFolder: vscode.WorkspaceFolder,
  configuration: SftpConfiguration
): string {
  const root = workspaceFolder.uri.fsPath;
  if (!configuration.localSubfolder) {
    return root;
  }
  return path.normalize(path.join(root, configuration.localSubfolder));
}

export function isMinimumConfigurationFilled(
  configuration: SftpConfiguration
): boolean {
  const commonBase =
    configuration.host.length > 0 &&
    configuration.username.length > 0 &&
    configuration.remoteRoot.length > 0;
  if (!commonBase) {
    return false;
  }
  if (configuration.protocol === "ftp") {
    return configuration.port > 0;
  }
  if (configuration.sshPasswordAuthentication) {
    return true;
  }
  if (configuration.useSshAgent) {
    return true;
  }
  return configuration.privateKeyPath.length > 0;
}

/**
 * Sem conexões definidas em sync.jsonc / sync.json.
 */
export function isConfigurationCompletelyEmpty(
  workspaceFolder: vscode.WorkspaceFolder
): boolean {
  return isSyncRootEmpty(readSyncJsonRootFromDisk(workspaceFolder));
}
