import * as path from "path";
import { minimatch } from "minimatch";

/**
 * Normaliza um caminho remoto POSIX (sem barras finais, exceto raiz `/`).
 */
export function normalizeRemotePosixPath(value: string): string {
  const s = value.trim().replace(/\\/g, "/");
  if (s.length === 0) {
    return "";
  }
  const withoutTrailing = s.replace(/\/+$/, "");
  return withoutTrailing.length === 0 ? "/" : withoutTrailing;
}

/**
 * Verifica se o caminho remoto candidato está na raiz configurada ou abaixo.
 */
export function isRemotePathDescendantOfRoot(
  remoteRootPosix: string,
  absoluteCandidatePosix: string
): boolean {
  const root = normalizeRemotePosixPath(remoteRootPosix);
  const target = normalizeRemotePosixPath(absoluteCandidatePosix);
  if (root === "" || target === "") {
    return false;
  }
  if (target === root) {
    return true;
  }
  const prefix = root === "/" ? "/" : `${root}/`;
  return target.startsWith(prefix);
}

/**
 * Segmento POSIX relativo à raiz remota configurada (vazio = própria raiz).
 */
export function remotePathRelativeToConfiguredRoot(
  configuredRemoteRoot: string,
  fullRemotePath: string
): string | undefined {
  const root = normalizeRemotePosixPath(configuredRemoteRoot);
  const fullPath = normalizeRemotePosixPath(fullRemotePath);
  if (root === "" || fullPath === "") {
    return undefined;
  }
  if (fullPath === root) {
    return "";
  }
  const prefix = root === "/" ? "/" : `${root}/`;
  if (!fullPath.startsWith(prefix)) {
    return undefined;
  }
  return fullPath.slice(prefix.length);
}

/**
 * Converte caminho local para segmento POSIX relativo à raiz local.
 */
export function posixRelativePath(
  absoluteFilePath: string,
  absoluteLocalRoot: string
): string | undefined {
  const relative = path.relative(absoluteLocalRoot, absoluteFilePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

/**
 * Junta raiz remota POSIX com caminho relativo POSIX.
 */
export function joinRemote(
  remoteRootPosix: string,
  posixRelative: string
): string {
  const base = remoteRootPosix.replace(/\/+$/, "");
  const resto = posixRelative.replace(/^\/+/, "");
  if (resto.length === 0) {
    return base;
  }
  return `${base}/${resto}`;
}

/**
 * Verifica se o caminho relativo (POSIX) deve ser ignorado pelos padrões.
 */
export function shouldIgnorePath(
  posixRelative: string,
  patterns: readonly string[]
): boolean {
  const normalized = posixRelative.replace(/^\/+/, "");
  for (const pattern of patterns) {
    const p = pattern.trim();
    if (p.length === 0) {
      continue;
    }
    if (minimatch(normalized, p, { dot: true })) {
      return true;
    }
    if (minimatch(`/${normalized}`, p, { dot: true })) {
      return true;
    }
  }
  return false;
}
