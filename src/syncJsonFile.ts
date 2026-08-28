import * as fs from "fs";
import * as path from "path";
import { parse, type ParseError } from "jsonc-parser";
import * as vscode from "vscode";
import { normalizeConnectionParametersFromRaw } from "./configAliases";

/** Ficheiro de configuração no workspace (JSON com comentários). */
export const SYNC_FILE_NAME = "sync.jsonc";

/** Nome legado; ainda lido se existir e `sync.jsonc` não existir. */
export const LEGACY_SYNC_FILE_NAME = "sync.json";

/**
 * Chave reservada na raiz (legado). Se existir, é preservada ao gravar o ficheiro;
 * a extensão já não a usa para escolher a conexão padrão (usa a primeira entrada no JSON).
 */
export const SYNC_DEFAULT_META_KEY = "syncDefault";

/** Protocolo remoto suportado pela extensão. */
export type RemoteProtocol = "sftp" | "ftp";

/** Modo TLS/FTP; só aplicável quando `protocolo` é `ftp`. */
export type FtpSecurityMode = "explicitFtps" | "plainFtp";

/**
 * Parâmetros de uma conexão (elemento do array no ficheiro de sync).
 */
export interface ConnectionParameters {
  /**
   * `sftp` (SSH/SFTP) ou `ftp`. Se omitido, assume-se `sftp` por compatibilidade.
   */
  protocol?: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  /**
   * Só para `protocolo: "ftp"`. Por defeito `explicitFtps` (AUTH TLS).
   * `plainFtp` envia credenciais e dados sem encriptação (aviso no registo).
   */
  ftpSecurityMode?: FtpSecurityMode;
  /**
   * Só para FTPS: se true, não falha com certificado TLS autoassinado ou inválido.
   */
  trustFtpSelfSignedCertificate?: boolean;
  /**
   * Se true, liga com utilizador + palavra-passe SSH (guardada no cofre por conexão).
   * Se false, usa `caminhoChavePrivada` e opcionalmente passphrase da chave (cofre global).
   */
  sshPasswordAuthentication: boolean;
  privateKeyPath: string;
  /**
   * Diretório remoto base (POSIX). Em SFTP deve ser preenchido. Em FTP, se vazio, a
   * extensão assume `/` (raiz após login), comum em alojamentos partilhados.
   */
  remoteRoot: string;
  localSubfolder: string;
  uploadOnSave: boolean;
  /**
   * Se true, ao apagar ficheiro ou pasta no explorador (gesto do editor), tenta apagar o
   * caminho correspondente no servidor. Por defeito false (destrutivo).
   */
  deleteRemoteOnLocalDelete: boolean;
  ignorePatterns: string[];
  /**
   * Se true, autentica via agente SSH (SSH_AUTH_SOCK). Ignora privateKeyPath.
   */
  useSshAgent?: boolean;
  /**
   * Se true, valida host key contra knownHostsPath (estilo OpenSSH). Default false.
   */
  strictHostKeyChecking?: boolean;
  /** Caminho para ficheiro known_hosts quando strictHostKeyChecking é true. */
  knownHostsPath?: string;
}

/**
 * Raiz do JSON: { "NomeDaConexao": [ { ...parametros } ], ... }
 * (sem a chave reservada `syncDefault`, que guarda só metadados.)
 */
export type SyncJsonRoot = Record<string, ConnectionParameters[]>;

/**
 * Conteúdo lido do ficheiro de sync: conexões e nome predefinido opcional.
 */
export interface SyncJsonReadResult {
  readonly connections: SyncJsonRoot;
  readonly syncDefaultFromFile?: string;
}

export function defaultConnectionParameters(): ConnectionParameters {
  return {
    protocol: "sftp",
    ftpSecurityMode: "explicitFtps",
    trustFtpSelfSignedCertificate: false,
    host: "",
    port: 22,
    username: "",
    sshPasswordAuthentication: false,
    privateKeyPath: "",
    remoteRoot: "",
    localSubfolder: "",
    uploadOnSave: true,
    deleteRemoteOnLocalDelete: false,
    useSshAgent: false,
    strictHostKeyChecking: false,
    knownHostsPath: "",
    ignorePatterns: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.vscode/**",
      "**/.cursor/**",
      "**/*.md",
      ".env",
      "**/.env",
      "**/.env.*",
      "**/vendor/**",
      "**/__pycache__/**",
      "**/.DS_Store",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/storage/logs/**",
      "**/*.log",
      "**/coverage/**",
      "**/.nuxt/**",
      "**/.output/**",
    ],
  };
}

export function syncJsonAbsolutePath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(
    workspaceFolder.uri.fsPath,
    ".vscode",
    SYNC_FILE_NAME
  );
}

export function legacySyncJsonAbsolutePath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return path.join(
    workspaceFolder.uri.fsPath,
    ".vscode",
    LEGACY_SYNC_FILE_NAME
  );
}

/**
 * Indica se o caminho absoluto aponta para o ficheiro de configuração DogSync (jsonc ou legado).
 */
export function isAbsolutePathSyncConfigFile(
  caminhoAbsoluto: string
): boolean {
  const base = path.basename(caminhoAbsoluto);
  return base === SYNC_FILE_NAME || base === LEGACY_SYNC_FILE_NAME;
}

function parseSyncRootText(text: string): unknown {
  if (text.trim().length === 0) {
    return {};
  }
  const errors: ParseError[] = [];
  const data = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `Ficheiro de sync inválido (código ${first.error} no offset ${first.offset}).`
    );
  }
  return data;
}

function normalizeEntryValue(value: unknown): ConnectionParameters[] {
  const base = defaultConnectionParameters();
  if (Array.isArray(value)) {
    return value.map((item) =>
      normalizeConnectionParametersFromRaw(item, base)
    );
  }
  if (value && typeof value === "object") {
    return [normalizeConnectionParametersFromRaw(value, base)];
  }
  return [{ ...base }];
}

/**
 * Lê `.vscode/sync.jsonc` (ou `sync.json` legado) do disco (síncrono), incluindo `syncDefault` se existir.
 */
export function readSyncJsonStructureFromDisk(
  workspaceFolder: vscode.WorkspaceFolder
): SyncJsonReadResult {
  const preferredPath = syncJsonAbsolutePath(workspaceFolder);
  const legacyPath = legacySyncJsonAbsolutePath(workspaceFolder);
  let selectedPath: string | undefined;
  if (fs.existsSync(preferredPath)) {
    selectedPath = preferredPath;
  } else if (fs.existsSync(legacyPath)) {
    selectedPath = legacyPath;
  }
  if (!selectedPath) {
    return { connections: {} };
  }
  try {
    const text = fs.readFileSync(selectedPath, "utf8");
    const data = parseSyncRootText(text) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { connections: {} };
    }
    let syncDefaultFromFile: string | undefined;
    const root: SyncJsonRoot = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key.startsWith("_")) {
        continue;
      }
      if (key === SYNC_DEFAULT_META_KEY) {
        if (typeof value === "string" && value.trim().length > 0) {
          syncDefaultFromFile = value.trim();
        }
        continue;
      }
      root[key] = normalizeEntryValue(value);
    }
    return { connections: root, syncDefaultFromFile };
  } catch {
    return { connections: {} };
  }
}

/**
 * Lê só o mapa de conexões (sem metadados como `syncDefault`).
 */
export function readSyncJsonRootFromDisk(
  workspaceFolder: vscode.WorkspaceFolder
): SyncJsonRoot {
  return readSyncJsonStructureFromDisk(workspaceFolder).connections;
}

export function listConnectionNames(root: SyncJsonRoot): string[] {
  return Object.keys(root).filter((k) => !k.startsWith("_"));
}

/**
 * Primeira conexão na ordem em que aparece em `.vscode/sync.jsonc` (ordem de chaves do objeto lido).
 * Usada como padrão para upload ao guardar e comandos que usam `lerConfiguracao`.
 */
export function getFirstConnectionNameInDeclaredOrder(
  root: SyncJsonRoot
): string {
  const names = listConnectionNames(root);
  return names.length > 0 ? names[0]! : "";
}

/**
 * Reordena as chaves no ficheiro de sync para que `nomeConexao` fique em primeiro lugar.
 * O padrão da extensão é sempre a primeira entrada do JSON (não usa settings.json).
 */
export function moveConnectionToFirstInSyncRoot(
  workspaceFolder: vscode.WorkspaceFolder,
  connectionName: string
): void {
  const name = connectionName.trim();
  if (name.length === 0) {
    return;
  }
  const root = readSyncJsonRootFromDisk(workspaceFolder);
  const blocks = root[name];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return;
  }
  const keysInOrder = listConnectionNames(root);
  const order = [name, ...keysInOrder.filter((key) => key !== name)];
  const newRoot: SyncJsonRoot = {};
  for (const key of order) {
    const entry = root[key];
    if (entry) {
      newRoot[key] = entry;
    }
  }
  writeSyncJsonRootToDisk(workspaceFolder, newRoot);
}

export function isSyncRootEmpty(root: SyncJsonRoot): boolean {
  return listConnectionNames(root).length === 0;
}

/**
 * Remove a entrada nomeada da raiz em disco e grava `sync.jsonc`.
 * Só altera o ficheiro se a chave existir.
 *
 * @returns true se a conexão existia e foi removida.
 */
export function removeConnectionFromSyncJsonRootOnDisk(
  workspaceFolder: vscode.WorkspaceFolder,
  connectionName: string
): boolean {
  const name = connectionName.trim();
  if (name.length === 0) {
    return false;
  }
  const root = readSyncJsonRootFromDisk(workspaceFolder);
  if (!Object.prototype.hasOwnProperty.call(root, name)) {
    return false;
  }
  const newRoot: SyncJsonRoot = { ...root };
  delete newRoot[name];
  writeSyncJsonRootToDisk(workspaceFolder, newRoot);
  return true;
}

function ensureVsCodeFolder(workspaceFolder: vscode.WorkspaceFolder): void {
  const vsCodeDir = path.join(workspaceFolder.uri.fsPath, ".vscode");
  if (!fs.existsSync(vsCodeDir)) {
    fs.mkdirSync(vsCodeDir, { recursive: true });
  }
}

/**
 * Escreve a raiz completa em `.vscode/sync.jsonc` (formatação com indentação).
 * Preserva `syncDefault` do ficheiro anterior só se ainda corresponder a uma chave em `raiz`.
 * Remove `sync.json` legado após gravar, para evitar duas fontes de verdade.
 */
export function writeSyncJsonRootToDisk(
  workspaceFolder: vscode.WorkspaceFolder,
  root: SyncJsonRoot
): void {
  ensureVsCodeFolder(workspaceFolder);
  const caminho = syncJsonAbsolutePath(workspaceFolder);
  const previous = readSyncJsonStructureFromDisk(workspaceFolder);
  const object: Record<string, unknown> = {};
  const previousSyncDefault = previous.syncDefaultFromFile?.trim();
  if (
    previousSyncDefault &&
    previousSyncDefault.length > 0 &&
    Object.prototype.hasOwnProperty.call(root, previousSyncDefault)
  ) {
    object[SYNC_DEFAULT_META_KEY] = previousSyncDefault;
  }
  for (const [key, value] of Object.entries(root)) {
    object[key] = value;
  }
  const text = JSON.stringify(object, null, 2) + "\n";
  fs.writeFileSync(caminho, text, "utf8");
  const legacy = legacySyncJsonAbsolutePath(workspaceFolder);
  if (fs.existsSync(legacy)) {
    try {
      fs.unlinkSync(legacy);
    } catch {
      /* ignorar */
    }
  }
}

/**
 * Upsert: adiciona ou substitui a chave na raiz com um array `[parametros]`.
 */
export function upsertConnectionInRoot(
  workspaceFolder: vscode.WorkspaceFolder,
  connectionName: string,
  parameters: ConnectionParameters = defaultConnectionParameters()
): void {
  const root = readSyncJsonRootFromDisk(workspaceFolder);
  root[connectionName] = [parameters];
  writeSyncJsonRootToDisk(workspaceFolder, root);
}

export async function openSyncJsonFileInEditor(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<void> {
  try {
    ensureVsCodeFolder(workspaceFolder);
    const jsoncPath = syncJsonAbsolutePath(workspaceFolder);
    const legacyPath = legacySyncJsonAbsolutePath(workspaceFolder);
    if (!fs.existsSync(jsoncPath) && fs.existsSync(legacyPath)) {
      try {
        fs.copyFileSync(legacyPath, jsoncPath);
        fs.unlinkSync(legacyPath);
      } catch {
        void vscode.window.showErrorMessage(
          "Não foi possível migrar sync.json para sync.jsonc."
        );
        return;
      }
    }
    if (!fs.existsSync(jsoncPath)) {
      fs.writeFileSync(jsoncPath, "{}\n", "utf8");
    }
    const uri = vscode.Uri.file(jsoncPath);
    /**
     * Usar `vscode.open` em vez de `openTextDocument`: no Cursor, openTextDocument
     * pode falhar com "Documents above the size limit cannot be synchronized with
     * extensions" mesmo em ficheiros pequenos (ex.: sync.jsonc ~10 KiB).
     */
    await vscode.commands.executeCommand("vscode.open", uri);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Não foi possível abrir .vscode/${SYNC_FILE_NAME}: ${detail}`
    );
  }
}

export function sanitizeConnectionName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
