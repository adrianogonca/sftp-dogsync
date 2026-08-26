import * as os from "os";
import * as path from "path";

/**
 * Dados do ficheiro em temp aberto a partir do painel remoto (upload ao guardar usa a mesma conexão).
 */
export interface OpenRemoteFileMetadata {
  readonly remotePosixPath: string;
  readonly connectionName: string;
}

const localPathToMetadata = new Map<
  string,
  OpenRemoteFileMetadata
>();

function localPathKey(caminhoAbsoluto: string): string {
  const normalized = path.normalize(caminhoAbsoluto);
  if (os.platform() === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

/**
 * Associa o ficheiro local (temp) ao destino remoto e à conexão usada ao abrir.
 */
export function registerOpenRemoteFile(
  absoluteLocalPath: string,
  remotePosixPath: string,
  connectionName: string
): void {
  const name = connectionName.trim();
  localPathToMetadata.set(localPathKey(absoluteLocalPath), {
    remotePosixPath,
    connectionName: name.length > 0 ? name : "(sem nome)",
  });
}

/**
 * Devolve metadados se este ficheiro local foi aberto a partir do painel remoto.
 */
export function getOpenRemoteFileMetadata(
  absoluteLocalPath: string
): OpenRemoteFileMetadata | undefined {
  return localPathToMetadata.get(
    localPathKey(absoluteLocalPath)
  );
}

/**
 * @deprecated Preferir obterMetadadosFicheiroRemotoAberto.
 */
export function getRemotePathIfTemporaryFile(
  absoluteLocalPath: string
): string | undefined {
  return getOpenRemoteFileMetadata(absoluteLocalPath)
    ?.remotePosixPath;
}

/**
 * Remove o registo (ex.: ao fechar o documento).
 */
export function removeRemoteFileRecord(
  absoluteLocalPath: string
): void {
  localPathToMetadata.delete(localPathKey(absoluteLocalPath));
}
