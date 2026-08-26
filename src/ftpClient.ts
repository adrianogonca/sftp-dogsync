import { createWriteStream } from "fs";
import { finished } from "stream/promises";
import * as fs from "fs/promises";
import * as path from "path";
import { Client } from "basic-ftp";
import {
  posixRelativePath,
  normalizeRemotePosixPath,
} from "./paths";
import {
  RemoteListingEntry,
  EDITOR_PREVIEW_BYTES_LIMIT,
  RemotePreviewResult,
} from "./sftpClient";
import type { FtpConnectionOptions } from "./remoteConnectionTypes";
import { logLine } from "./logger";
import { withPooledFtp } from "./connectionPool";

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

export async function listRemoteDirectoryFtp(
  poolKey: string,
  options: FtpConnectionOptions,
  remoteDirectoryPosixPath: string
): Promise<RemoteListingEntry[]> {
  return withPooledFtp(poolKey, options, async (client) => {
    if (options.ftpSecurityMode === "plainFtp") {
      logLine(
        "[DogSync FTP] Aviso: ligação em claro (sem TLS). Credenciais e dados transitam sem encriptação."
      );
    }
    const base = remoteDirectoryPosixPath.replace(/\/+$/, "") || "/";
    const lista = await client.list(base);
    const result: RemoteListingEntry[] = [];
    for (const item of lista) {
      if (item.name === "." || item.name === "..") {
        continue;
      }
      const fullPath =
        base === "/" ? `/${item.name}` : `${base}/${item.name}`;
      result.push({
        name: item.name,
        isDirectory: item.isDirectory,
        fullRemotePath: fullPath,
      });
    }
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return result;
  });
}

export async function uploadLocalFileToRemoteFtp(
  poolKey: string,
  options: FtpConnectionOptions,
  caminhoLocal: string,
  remotePosixPath: string
): Promise<void> {
  return withPooledFtp(poolKey, options, async (client) => {
    const remoteDirectory = path.posix.dirname(remotePosixPath);
    await client.ensureDir(remoteDirectory);
    await client.uploadFrom(caminhoLocal, remotePosixPath);
    logLine(`Enviado (FTP): ${caminhoLocal} -> ${remotePosixPath}`);
  });
}

async function uploadFolderRecursiveWithFilterFtp(
  client: Client,
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
      await uploadFolderRecursiveWithFilterFtp(
        client,
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
      await client.ensureDir(remoteParentDir);
      await client.uploadFrom(childLocal, childRemote);
      logLine(`Enviado (FTP): ${childLocal} -> ${childRemote}`);
    }
  }
}

export async function uploadLocalPathToRemoteRecursiveFtp(
  poolKey: string,
  options: FtpConnectionOptions,
  absoluteLocalPath: string,
  destinationRemotePosixPath: string,
  absoluteLocalRoot: string,
  shouldIgnoreRelative: (posixRelative: string) => boolean
): Promise<void> {
  return withPooledFtp(poolKey, options, async (client) => {
    const stats = await fs.stat(absoluteLocalPath);
    if (stats.isDirectory()) {
      const remoteDir = destinationRemotePosixPath.replace(/\/+$/, "");
      await client.ensureDir(remoteDir);
      await uploadFolderRecursiveWithFilterFtp(
        client,
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
      await client.ensureDir(parentDir);
      await client.uploadFrom(absoluteLocalPath, destinationRemotePosixPath);
      logLine(
        `Enviado (FTP): ${absoluteLocalPath} -> ${destinationRemotePosixPath}`
      );
    }
  });
}

async function deleteRecursiveInsideFtpConnection(
  client: Client,
  posixPath: string
): Promise<void> {
  try {
    await client.remove(posixPath);
    logLine(`Removido ficheiro remoto (FTP): ${posixPath}`);
    return;
  } catch {
    /* não é ficheiro ou falhou — tentar diretório */
  }
  await client.removeDir(posixPath);
  logLine(`Removido diretório remoto (FTP): ${posixPath}`);
}

export async function deleteRemotePathFtp(
  poolKey: string,
  options: FtpConnectionOptions,
  remotePosixPath: string
): Promise<void> {
  const target = normalizeRemotePosixPath(remotePosixPath);
  if (target.length === 0) {
    throw new Error("Caminho remoto inválido.");
  }
  return withPooledFtp(poolKey, options, async (client) => {
    await deleteRecursiveInsideFtpConnection(client, target);
  });
}

async function downloadFolderRecursiveFtp(
  client: Client,
  remotoPosix: string,
  localAbsoluto: string
): Promise<void> {
  await fs.mkdir(localAbsoluto, { recursive: true });
  const base = remotoPosix.replace(/\/+$/, "") || "/";
  const lista = await client.list(base);
  for (const item of lista) {
    if (item.name === "." || item.name === "..") {
      continue;
    }
    const childRemote =
      base === "/" ? `/${item.name}` : `${base}/${item.name}`;
    const childLocal = path.join(localAbsoluto, item.name);
    if (item.isDirectory) {
      await downloadFolderRecursiveFtp(client, childRemote, childLocal);
    } else {
      await fs.mkdir(path.dirname(childLocal), { recursive: true });
      await client.downloadTo(childLocal, childRemote);
      logLine(`Descarregado (FTP): ${childRemote} -> ${childLocal}`);
    }
  }
}

export async function downloadRemoteFileForPreviewFtp(
  poolKey: string,
  options: FtpConnectionOptions,
  remotePosixPath: string,
  destinationLocalPath: string
): Promise<RemotePreviewResult> {
  return withPooledFtp(poolKey, options, async (client) => {
    let remoteSize: number;
    try {
      remoteSize = await client.size(remotePosixPath);
    } catch (error) {
      const lista = await client.list(remotePosixPath).catch(() => []);
      if (
        lista.length === 1 &&
        lista[0]!.isDirectory &&
        lista[0]!.name === path.posix.basename(remotePosixPath)
      ) {
        throw new Error("O caminho remoto é um diretório, não um ficheiro.");
      }
      throw error;
    }
    if (!Number.isFinite(remoteSize) || remoteSize < 0) {
      throw new Error("Não foi possível obter o tamanho do ficheiro remoto.");
    }
    await fs.mkdir(path.dirname(destinationLocalPath), { recursive: true });
    if (remoteSize === 0) {
      await fs.writeFile(destinationLocalPath, "", "utf8");
      logLine(
        `Pré-visualização FTP (vazio): ${remotePosixPath} -> ${destinationLocalPath}`
      );
      return {
        truncated: false,
        remoteSize: 0,
        bytesWrittenLocally: 0,
      };
    }
    if (remoteSize <= EDITOR_PREVIEW_BYTES_LIMIT) {
      await client.downloadTo(destinationLocalPath, remotePosixPath);
      logLine(
        `Descarregado (FTP): ${remotePosixPath} -> ${destinationLocalPath}`
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
    await fs.writeFile(destinationLocalPath, notice, "utf8");
    const appendStream = createWriteStream(destinationLocalPath, { flags: "a" });
    try {
      await client.downloadTo(appendStream, remotePosixPath, startByte);
      await finished(appendStream);
    } finally {
      appendStream.destroy();
    }
    logLine(
      `Pré-visualização FTP truncada (${formatBytesSize(tail)}): ${remotePosixPath} -> ${destinationLocalPath}`
    );
    return {
      truncated: true,
      remoteSize,
      bytesWrittenLocally: Buffer.byteLength(notice, "utf8") + tail,
    };
  });
}

export async function downloadRemoteToLocalFtp(
  poolKey: string,
  options: FtpConnectionOptions,
  remotePosixPath: string,
  destinationLocalPath: string
): Promise<void> {
  return withPooledFtp(poolKey, options, async (client) => {
    let isFileSize = false;
    try {
      await client.size(remotePosixPath);
      isFileSize = true;
    } catch {
      isFileSize = false;
    }
    if (isFileSize) {
      await fs.mkdir(path.dirname(destinationLocalPath), { recursive: true });
      await client.downloadTo(destinationLocalPath, remotePosixPath);
      logLine(
        `Descarregado (FTP): ${remotePosixPath} -> ${destinationLocalPath}`
      );
      return;
    }
    await downloadFolderRecursiveFtp(
      client,
      remotePosixPath,
      destinationLocalPath
    );
  });
}
