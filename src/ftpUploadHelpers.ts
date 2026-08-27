import * as path from "path";
import type { Client } from "basic-ftp";
import { logLine } from "./logger";

/**
 * basic-ftp `ensureDir` muda o CWD para o diretório alvo.
 * Depois disso o upload deve usar só o basename — path absoluto após ensureDir
 * falha ou grava no sítio errado em vários alojamentos (ex.: Hostinger).
 */
export async function uploadLocalFileViaFtpClient(
  client: Client,
  localAbsolutePath: string,
  remotePosixPath: string
): Promise<void> {
  const normalized = remotePosixPath.replace(/\\/g, "/");
  const parentDir = path.posix.dirname(normalized);
  const fileName = path.posix.basename(normalized);
  if (fileName.length === 0 || fileName === "." || fileName === "..") {
    throw new Error(`Caminho remoto de ficheiro inválido: ${remotePosixPath}`);
  }
  const directory =
    parentDir === "." || parentDir.length === 0 ? "/" : parentDir;
  await client.ensureDir(directory);
  await client.uploadFrom(localAbsolutePath, fileName);
  logLine(`Enviado (FTP): ${localAbsolutePath} -> ${normalized}`);
}
