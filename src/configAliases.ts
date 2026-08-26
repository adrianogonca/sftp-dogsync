import * as vscode from "vscode";
import type { ConnectionParameters, FtpSecurityMode, RemoteProtocol } from "./syncJsonFile";

export interface SettingAlias<T> {
  readonly englishKey: string;
  readonly portugueseKey: string;
  readonly defaultValue: T;
}

export const SETTING_ENABLED: SettingAlias<boolean> = {
  englishKey: "enabled",
  portugueseKey: "ativo",
  defaultValue: true,
};

export const SETTING_CONNECTION_NAME: SettingAlias<string> = {
  englishKey: "connectionName",
  portugueseKey: "nomeConexao",
  defaultValue: "",
};

export const SETTING_HOST: SettingAlias<string> = {
  englishKey: "host",
  portugueseKey: "servidor",
  defaultValue: "",
};

export const SETTING_PORT: SettingAlias<number> = {
  englishKey: "port",
  portugueseKey: "porta",
  defaultValue: 22,
};

export const SETTING_USERNAME: SettingAlias<string> = {
  englishKey: "username",
  portugueseKey: "utilizador",
  defaultValue: "",
};

export const SETTING_PRIVATE_KEY_PATH: SettingAlias<string> = {
  englishKey: "privateKeyPath",
  portugueseKey: "caminhoChavePrivada",
  defaultValue: "",
};

export const SETTING_SSH_PASSWORD_AUTHENTICATION: SettingAlias<boolean> = {
  englishKey: "sshPasswordAuthentication",
  portugueseKey: "autenticacaoPorPalavraPasseSsh",
  defaultValue: false,
};

export const SETTING_REMOTE_ROOT: SettingAlias<string> = {
  englishKey: "remoteRoot",
  portugueseKey: "raizRemota",
  defaultValue: "",
};

export const SETTING_LOCAL_SUBFOLDER: SettingAlias<string> = {
  englishKey: "localSubfolder",
  portugueseKey: "subpastaLocal",
  defaultValue: "",
};

export const SETTING_UPLOAD_ON_SAVE: SettingAlias<boolean> = {
  englishKey: "uploadOnSave",
  portugueseKey: "uploadAoGuardar",
  defaultValue: true,
};

export const SETTING_DELETE_REMOTE_ON_LOCAL_DELETE: SettingAlias<boolean> = {
  englishKey: "deleteRemoteOnLocalDelete",
  portugueseKey: "eliminarRemotoAoEliminarLocal",
  defaultValue: false,
};

export const SETTING_IGNORE_PATTERNS: SettingAlias<string[]> = {
  englishKey: "ignorePatterns",
  portugueseKey: "padroesIgnorar",
  defaultValue: [],
};

const CONNECTION_FIELD_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["protocol", "protocolo"],
  ["host", "servidor"],
  ["port", "porta"],
  ["username", "utilizador"],
  ["ftpSecurityMode", "modoSegurancaFtp"],
  ["trustFtpSelfSignedCertificate", "confiarEmCertificadoFtpAutoassinado"],
  ["sshPasswordAuthentication", "autenticacaoPorPalavraPasseSsh"],
  ["privateKeyPath", "caminhoChavePrivada"],
  ["remoteRoot", "raizRemota"],
  ["localSubfolder", "subpastaLocal"],
  ["uploadOnSave", "uploadAoGuardar"],
  ["deleteRemoteOnLocalDelete", "eliminarRemotoAoEliminarLocal"],
  ["ignorePatterns", "padroesIgnorar"],
  ["useSshAgent", "usarAgenteSsh"],
  ["strictHostKeyChecking", "verificacaoEstritaHostKey"],
  ["knownHostsPath", "caminhoKnownHosts"],
];

export const PRIVATE_KEY_PASSPHRASE_SECRET_KEY_LEGACY =
  "sftpSync.passphraseChavePrivada";

export const INTRO_COMPLETED_KEY_LEGACY =
  "sftpSync.introConfiguracaoConcluida";

/**
 * Lê setting canónico EN; se não estiver definido no user/workspace, usa a chave PT.
 */
export function readSettingWithFallback<T>(
  configuration: vscode.WorkspaceConfiguration,
  alias: SettingAlias<T>
): T {
  const inspectEnglish = configuration.inspect<T>(alias.englishKey);
  const englishSet =
    inspectEnglish?.workspaceFolderValue ??
    inspectEnglish?.workspaceValue ??
    inspectEnglish?.globalValue;
  if (englishSet !== undefined) {
    return englishSet;
  }
  const inspectPortuguese = configuration.inspect<T>(alias.portugueseKey);
  const portugueseSet =
    inspectPortuguese?.workspaceFolderValue ??
    inspectPortuguese?.workspaceValue ??
    inspectPortuguese?.globalValue;
  if (portugueseSet !== undefined) {
    return portugueseSet;
  }
  return alias.defaultValue;
}

function pickAliasedField(
  raw: Record<string, unknown>,
  englishKey: string,
  portugueseKey: string
): unknown {
  if (Object.prototype.hasOwnProperty.call(raw, englishKey)) {
    return raw[englishKey];
  }
  if (Object.prototype.hasOwnProperty.call(raw, portugueseKey)) {
    return raw[portugueseKey];
  }
  return undefined;
}

function normalizeRemoteProtocol(value: unknown): RemoteProtocol | undefined {
  if (value === "ftp" || value === "sftp") {
    return value;
  }
  return undefined;
}

function normalizeFtpSecurityMode(value: unknown): FtpSecurityMode {
  if (value === "plainFtp" || value === "ftpClaro") {
    return "plainFtp";
  }
  return "explicitFtps";
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Converte um objeto de conexão (chaves EN ou PT) para o contrato canónico EN.
 */
export function normalizeConnectionParametersFromRaw(
  raw: unknown,
  defaults: ConnectionParameters
): ConnectionParameters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...defaults };
  }
  const record = raw as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const [englishKey, portugueseKey] of CONNECTION_FIELD_ALIASES) {
    const value = pickAliasedField(record, englishKey, portugueseKey);
    if (value !== undefined) {
      picked[englishKey] = value;
    }
  }
  const protocol = normalizeRemoteProtocol(picked.protocol) ?? defaults.protocol;
  return {
    protocol,
    host: asString(picked.host, defaults.host),
    port: asNumber(picked.port, defaults.port),
    username: asString(picked.username, defaults.username),
    ftpSecurityMode: picked.ftpSecurityMode
      ? normalizeFtpSecurityMode(picked.ftpSecurityMode)
      : defaults.ftpSecurityMode,
    trustFtpSelfSignedCertificate: asBoolean(
      picked.trustFtpSelfSignedCertificate,
      Boolean(defaults.trustFtpSelfSignedCertificate)
    ),
    sshPasswordAuthentication: asBoolean(
      picked.sshPasswordAuthentication,
      defaults.sshPasswordAuthentication
    ),
    privateKeyPath: asString(picked.privateKeyPath, defaults.privateKeyPath),
    remoteRoot: asString(picked.remoteRoot, defaults.remoteRoot),
    localSubfolder: asString(picked.localSubfolder, defaults.localSubfolder),
    uploadOnSave: asBoolean(picked.uploadOnSave, defaults.uploadOnSave),
    deleteRemoteOnLocalDelete: asBoolean(
      picked.deleteRemoteOnLocalDelete,
      defaults.deleteRemoteOnLocalDelete
    ),
    ignorePatterns: asStringArray(picked.ignorePatterns, defaults.ignorePatterns),
    useSshAgent: asBoolean(picked.useSshAgent, Boolean(defaults.useSshAgent)),
    strictHostKeyChecking: asBoolean(
      picked.strictHostKeyChecking,
      Boolean(defaults.strictHostKeyChecking)
    ),
    knownHostsPath: asString(picked.knownHostsPath, defaults.knownHostsPath ?? ""),
  };
}

export function sanitizeSecretKeySegment(connectionName: string): string {
  return connectionName.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "default";
}

export function sshPasswordSecretKeyEnglish(connectionName: string): string {
  return `sftpSync.sshPassword.${sanitizeSecretKeySegment(connectionName)}`;
}

export function sshPasswordSecretKeyPortuguese(connectionName: string): string {
  return `sftpSync.palavraPasseSsh.${sanitizeSecretKeySegment(connectionName)}`;
}

export function ftpPasswordSecretKeyEnglish(connectionName: string): string {
  return `sftpSync.ftpPassword.${sanitizeSecretKeySegment(connectionName)}`;
}

export function ftpPasswordSecretKeyPortuguese(connectionName: string): string {
  return `sftpSync.palavraPasseFtp.${sanitizeSecretKeySegment(connectionName)}`;
}

export async function readSecretWithFallback(
  secrets: vscode.SecretStorage,
  englishKey: string,
  portugueseKey: string
): Promise<string | undefined> {
  const englishValue = await secrets.get(englishKey);
  if (englishValue !== undefined && englishValue.length > 0) {
    return englishValue;
  }
  const portugueseValue = await secrets.get(portugueseKey);
  if (portugueseValue !== undefined && portugueseValue.length > 0) {
    await secrets.store(englishKey, portugueseValue);
    await secrets.delete(portugueseKey);
    return portugueseValue;
  }
  return undefined;
}

export async function deleteSecretWithFallback(
  secrets: vscode.SecretStorage,
  englishKey: string,
  portugueseKey: string
): Promise<void> {
  await secrets.delete(englishKey);
  await secrets.delete(portugueseKey);
}

export async function storeSecretMigrating(
  secrets: vscode.SecretStorage,
  englishKey: string,
  portugueseKey: string,
  value: string
): Promise<void> {
  await secrets.store(englishKey, value);
  await secrets.delete(portugueseKey);
}

export const PORTUGUESE_COMMAND_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["sftpSync.testarConexao", "sftpSync.testConnection"],
  ["sftpSync.recarregarJanelaEditor", "sftpSync.reloadEditorWindow"],
  ["sftpSync.mostrarLog", "sftpSync.showLog"],
  ["sftpSync.adicionarConexao", "sftpSync.addConnection"],
  ["sftpSync.abrirSyncJson", "sftpSync.openSyncJson"],
  ["sftpSync.abrirCofreSenha", "sftpSync.openPasswordVault"],
  ["sftpSync.cofreSenhaAtribuirArvore", "sftpSync.setVaultPasswordFromTree"],
  ["sftpSync.removerSenhaCofreConexaoArvore", "sftpSync.removeVaultPasswordFromTree"],
  ["sftpSync.definirConexaoPadrao", "sftpSync.setDefaultConnection"],
  ["sftpSync.abrirSyncJsonEmConexao", "sftpSync.openSyncJsonAtConnection"],
  ["sftpSync.removerConexaoDoSyncJsonc", "sftpSync.removeConnectionFromSyncJsonc"],
  ["sftpSync.abrirRemotoNoEditor", "sftpSync.openRemoteInEditor"],
  ["sftpSync.eliminarRemoto", "sftpSync.deleteRemote"],
  ["sftpSync.descarregarRemotoPainel", "sftpSync.downloadRemoteFromPanel"],
  ["sftpSync.definirPalavraPasseChave", "sftpSync.setPrivateKeyPassphrase"],
  ["sftpSync.definirPalavraPasseSsh", "sftpSync.setSshPassword"],
  ["sftpSync.definirPalavraPasseFtp", "sftpSync.setFtpPassword"],
  ["sftpSync.enviarFicheiroAtual", "sftpSync.uploadCurrentFile"],
  ["sftpSync.enviarCaminho", "sftpSync.uploadPath"],
  ["sftpSync.descarregarCaminho", "sftpSync.downloadPath"],
];
