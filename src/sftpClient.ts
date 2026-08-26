import { createWriteStream } from "fs";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { constants as fsConstants } from "fs";
import { pipeline } from "stream/promises";
import * as path from "path";
import { SFTPWrapper, FileEntry } from "ssh2";
import {
  posixRelativePath,
  normalizeRemotePosixPath,
} from "./paths";
import { logError, logLine } from "./logger";
import { withPooledSftp } from "./connectionPool";

/** Abaixo do limite ~50MB do Cursor/VS Code para ficheiros temporários sincronizados com extensões. */
export const EDITOR_PREVIEW_BYTES_LIMIT = 45 * 1024 * 1024;

const PREVIEW_TAIL_MAX_BYTES = 8 * 1024 * 1024;

function formatBytesSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export interface ConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly privateKeyBuffer?: Buffer;
  readonly keyPassphrase?: string;
  readonly sshPassword?: string;
  readonly useSshAgent?: boolean;
  readonly strictHostKeyChecking?: boolean;
  readonly knownHostsPath?: string;
}

function promiseFastPut(
  sftp: SFTPWrapper,
  local: string,
  remoto: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remoto, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function promiseFastGet(
  sftp: SFTPWrapper,
  remoto: string,
  local: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remoto, local, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function promiseMkdir(
  sftp: SFTPWrapper,
  remotePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function promiseStat(
  sftp: SFTPWrapper,
  remotePath: string
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stats);
    });
  });
}

function promiseReaddir(
  sftp: SFTPWrapper,
  remotePath: string
): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, lista) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(lista);
    });
  });
}

function promiseUnlink(
  sftp: SFTPWrapper,
  remotePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function promiseRmdir(
  sftp: SFTPWrapper,
  remotePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isDirectoryEntry(entry: FileEntry): boolean {
  const modo = entry.attrs.mode;
  if (modo === undefined) {
    return false;
  }
  return (modo & fsConstants.S_IFMT) === fsConstants.S_IFDIR;
}

/**
 * Entrada de listagem de um diretório remoto (nível único).
 */
export interface RemoteListingEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly fullRemotePath: string;
}

function sortListingEntries(
  a: RemoteListingEntry,
  b: RemoteListingEntry
): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Lista o conteúdo de um diretório remoto (abre ligação, lista e fecha).
 */
export async function listRemoteDirectory(
  poolKey: string,
  options: ConnectionOptions,
  remoteDirectoryPosixPath: string
): Promise<RemoteListingEntry[]> {
  return withPooledSftp(poolKey, options, async (sftp) => {
    const base = remoteDirectoryPosixPath.replace(/\/+$/, "") || "/";
    const entries = await promiseReaddir(sftp, base);
    const result: RemoteListingEntry[] = [];
    for (const entry of entries) {
      if (entry.filename === "." || entry.filename === "..") {
        continue;
      }
      const fullPath =
        base === "/"
          ? `/${entry.filename}`
          : `${base}/${entry.filename}`;
      result.push({
        name: entry.filename,
        isDirectory: isDirectoryEntry(entry),
        fullRemotePath: fullPath,
      });
    }
    result.sort(sortListingEntries);
    return result;
  });
}

/**
 * Garante que todos os segmentos do caminho remoto existem (mkdir recursivo).
 */
async function ensureRemoteDirectory(
  sftp: SFTPWrapper,
  diretorioRemotoPosix: string
): Promise<void> {
  const normalized = diretorioRemotoPosix.replace(/\/+$/, "") || "/";
  if (!normalized.startsWith("/")) {
    const segmentos = normalized.split("/").filter((s) => s.length > 0);
    let accumulated = "";
    for (const segmento of segmentos) {
      accumulated = accumulated ? `${accumulated}/${segmento}` : segmento;
      try {
        await promiseStat(sftp, accumulated);
      } catch {
        await promiseMkdir(sftp, accumulated);
        logLine(`Diretório remoto criado: ${accumulated}`);
      }
    }
    return;
  }
  const segmentos = normalized.split("/").filter((s) => s.length > 0);
  let prefix = "";
  for (const segmento of segmentos) {
    prefix += `/${segmento}`;
    try {
      await promiseStat(sftp, prefix);
    } catch {
      try {
        await promiseMkdir(sftp, prefix);
        logLine(`Diretório remoto criado: ${prefix}`);
      } catch (erroCriacao) {
        logError(`Falha ao criar diretório remoto ${prefix}`, erroCriacao);
        throw erroCriacao;
      }
    }
  }
}

export async function uploadLocalFileToRemote(
  poolKey: string,
  options: ConnectionOptions,
  caminhoLocal: string,
  remotePosixPath: string
): Promise<void> {
  return withPooledSftp(poolKey, options, async (sftp) => {
    const remoteDirectory = path.posix.dirname(remotePosixPath);
    await ensureRemoteDirectory(sftp, remoteDirectory);
    await promiseFastPut(sftp, caminhoLocal, remotePosixPath);
    logLine(`Enviado: ${caminhoLocal} -> ${remotePosixPath}`);
  });
}

async function uploadFolderRecursiveWithFilter(
  sftp: SFTPWrapper,
  localDirPath: string,
  remoteDirPosixPath: string,
  absoluteLocalRoot: string,
  shouldIgnoreRelative: (posixRelative: string) => boolean
): Promise<void> {
  const baseRemoto = remoteDirPosixPath.replace(/\/+$/, "");
  const entries = await fs.readdir(localDirPath, { withFileTypes: true });
  for (const entry of entries) {
    const childLocal = path.join(localDirPath, entry.name);
    const childRemote =
      baseRemoto === "/" ? `/${entry.name}` : `${baseRemoto}/${entry.name}`;
    if (entry.isDirectory()) {
      await uploadFolderRecursiveWithFilter(
        sftp,
        childLocal,
        childRemote,
        absoluteLocalRoot,
        shouldIgnoreRelative
      );
    } else {
      const relative = posixRelativePath(childLocal, absoluteLocalRoot);
      if (relative === undefined || shouldIgnoreRelative(relative)) {
        continue;
      }
      const remoteParentDir = path.posix.dirname(childRemote);
      await ensureRemoteDirectory(sftp, remoteParentDir);
      await promiseFastPut(sftp, childLocal, childRemote);
      logLine(`Enviado: ${childLocal} -> ${childRemote}`);
    }
  }
}

/**
 * Envia ficheiro ou pasta (recursivo) numa única ligação SFTP, respeitando o filtro em cada ficheiro.
 */
export async function uploadLocalPathToRemoteRecursive(
  poolKey: string,
  options: ConnectionOptions,
  absoluteLocalPath: string,
  destinationRemotePosixPath: string,
  absoluteLocalRoot: string,
  shouldIgnoreRelative: (posixRelative: string) => boolean
): Promise<void> {
  return withPooledSftp(poolKey, options, async (sftp) => {
    const stats = await fs.stat(absoluteLocalPath);
    if (stats.isDirectory()) {
      const remoteDir = destinationRemotePosixPath.replace(/\/+$/, "");
      await ensureRemoteDirectory(sftp, remoteDir);
      await uploadFolderRecursiveWithFilter(
        sftp,
        absoluteLocalPath,
        remoteDir,
        absoluteLocalRoot,
        shouldIgnoreRelative
      );
    } else {
      const relative = posixRelativePath(
        absoluteLocalPath,
        absoluteLocalRoot
      );
      if (relative === undefined || shouldIgnoreRelative(relative)) {
        return;
      }
      const parentDir = path.posix.dirname(destinationRemotePosixPath);
      await ensureRemoteDirectory(sftp, parentDir);
      await promiseFastPut(
        sftp,
        absoluteLocalPath,
        destinationRemotePosixPath
      );
      logLine(
        `Enviado: ${absoluteLocalPath} -> ${destinationRemotePosixPath}`
      );
    }
  });
}

async function downloadFolderRecursive(
  sftp: SFTPWrapper,
  remotoPosix: string,
  localAbsoluto: string
): Promise<void> {
  await fs.mkdir(localAbsoluto, { recursive: true });
  const entries = await promiseReaddir(sftp, remotoPosix);
  for (const entry of entries) {
    if (entry.filename === "." || entry.filename === "..") {
      continue;
    }
    const childRemote = `${remotoPosix.replace(/\/+$/, "")}/${entry.filename}`;
    const childLocal = path.join(localAbsoluto, entry.filename);
    if (isDirectoryEntry(entry)) {
      await downloadFolderRecursive(sftp, childRemote, childLocal);
    } else {
      await fs.mkdir(path.dirname(childLocal), { recursive: true });
      await promiseFastGet(sftp, childRemote, childLocal);
      logLine(`Descarregado: ${childRemote} -> ${childLocal}`);
    }
  }
}

function isDirectoryStats(stats: { mode?: number }): boolean {
  if (stats.mode === undefined) {
    return false;
  }
  return (stats.mode & fsConstants.S_IFMT) === fsConstants.S_IFDIR;
}

async function deleteRecursiveInsideConnection(
  sftp: SFTPWrapper,
  posixPath: string
): Promise<void> {
  const stats = (await promiseStat(sftp, posixPath)) as { mode?: number };
  if (isDirectoryStats(stats)) {
    const base = posixPath.replace(/\/+$/, "") || "/";
    const entries = await promiseReaddir(sftp, base);
    for (const entry of entries) {
      if (entry.filename === "." || entry.filename === "..") {
        continue;
      }
      const filho =
        base === "/"
          ? `/${entry.filename}`
          : `${base}/${entry.filename}`;
      await deleteRecursiveInsideConnection(sftp, filho);
    }
    await promiseRmdir(sftp, base);
    logLine(`Removido diretório remoto: ${base}`);
  } else {
    await promiseUnlink(sftp, posixPath);
    logLine(`Removido ficheiro remoto: ${posixPath}`);
  }
}

/**
 * Elimina ficheiro ou pasta remota (pasta com todo o conteúdo). Abre uma ligação SFTP.
 */
export async function deleteRemotePath(
  poolKey: string,
  options: ConnectionOptions,
  remotePosixPath: string
): Promise<void> {
  const target = normalizeRemotePosixPath(remotePosixPath);
  if (target.length === 0) {
    throw new Error("Caminho remoto inválido.");
  }
  return withPooledSftp(poolKey, options, async (sftp) => {
    await deleteRecursiveInsideConnection(sftp, target);
  });
}

export interface RemotePreviewResult {
  readonly truncated: boolean;
  readonly remoteSize: number;
  readonly bytesWrittenLocally: number;
}

/**
 * Descarrega um ficheiro remoto para abrir no editor. Se exceder o limite de sincronização
 * (~50MB no Cursor), grava só a cauda (últimos 8 MiB) com aviso no topo — não registar para upload ao guardar.
 */
export async function downloadRemoteFileForPreview(
  poolKey: string,
  options: ConnectionOptions,
  remotePosixPath: string,
  destinationLocalPath: string
): Promise<RemotePreviewResult> {
  return withPooledSftp(poolKey, options, async (sftp) => {
    const stats = (await promiseStat(sftp, remotePosixPath)) as {
      mode?: number;
      size?: number;
    };
    if (isDirectoryStats(stats)) {
      throw new Error("O caminho remoto é um diretório, não um ficheiro.");
    }
    const remoteSize = Number(stats.size ?? 0);
    if (!Number.isFinite(remoteSize) || remoteSize < 0) {
      throw new Error("Não foi possível obter o tamanho do ficheiro remoto.");
    }
    await fs.mkdir(path.dirname(destinationLocalPath), { recursive: true });
    if (remoteSize === 0) {
      await fs.writeFile(destinationLocalPath, "", "utf8");
      logLine(
        `Pré-visualização (vazio): ${remotePosixPath} -> ${destinationLocalPath}`
      );
      return {
        truncated: false,
        remoteSize: 0,
        bytesWrittenLocally: 0,
      };
    }
    if (remoteSize <= EDITOR_PREVIEW_BYTES_LIMIT) {
      await promiseFastGet(sftp, remotePosixPath, destinationLocalPath);
      logLine(
        `Descarregado: ${remotePosixPath} -> ${destinationLocalPath}`
      );
      return {
        truncated: false,
        remoteSize,
        bytesWrittenLocally: remoteSize,
      };
    }
    const tail = Math.min(PREVIEW_TAIL_MAX_BYTES, remoteSize);
    const startByte = remoteSize - tail;
    const notice =
      `[DogSync] Pré-visualização: últimos ${formatBytesSize(tail)} de ${formatBytesSize(
        remoteSize
      )} no servidor.\n` +
      `Remoto: ${remotePosixPath}\n` +
      "Este ficheiro local está truncado: guardar NÃO substitui o ficheiro completo no servidor (upload desativado para esta sessão).\n\n";
    const writeStream = createWriteStream(destinationLocalPath);
    await new Promise<void>((resolver, rejeitar) => {
      writeStream.write(notice, "utf8", (error) => {
        if (error) {
          rejeitar(error);
          return;
        }
        resolver();
      });
    });
    const readStream = sftp.createReadStream(remotePosixPath, {
      start: startByte,
      end: remoteSize - 1,
    });
    await pipeline(readStream, writeStream);
    const headerBytes = Buffer.byteLength(notice, "utf8");
    logLine(
      `Pré-visualização truncada (${formatBytesSize(tail)}): ${remotePosixPath} -> ${destinationLocalPath}`
    );
    return {
      truncated: true,
      remoteSize,
      bytesWrittenLocally: headerBytes + tail,
    };
  });
}

export async function downloadRemoteToLocal(
  poolKey: string,
  options: ConnectionOptions,
  remotePosixPath: string,
  destinationLocalPath: string
): Promise<void> {
  return withPooledSftp(poolKey, options, async (sftp) => {
    const stats = (await promiseStat(sftp, remotePosixPath)) as {
      mode?: number;
    };
    if (isDirectoryStats(stats)) {
      await downloadFolderRecursive(sftp, remotePosixPath, destinationLocalPath);
    } else {
      await fs.mkdir(path.dirname(destinationLocalPath), { recursive: true });
      await promiseFastGet(sftp, remotePosixPath, destinationLocalPath);
      logLine(
        `Descarregado: ${remotePosixPath} -> ${destinationLocalPath}`
      );
    }
  });
}

export function readPrivateKeyFromDisk(caminhoAbsoluto: string): Buffer {
  return fsSync.readFileSync(caminhoAbsoluto);
}
