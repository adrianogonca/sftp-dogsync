import * as crypto from "crypto";
import * as fs from "fs";

/**
 * Verifica chave do host contra ficheiro OpenSSH known_hosts (formato linha simples).
 * Se o ficheiro não existir ou estiver vazio, rejeita quando strict=true.
 */
export function verifyKnownHostKey(
  host: string,
  port: number,
  remoteKey: Buffer,
  knownHostsPath: string | undefined,
  strictHostKeyChecking: boolean
): boolean {
  if (!strictHostKeyChecking) {
    return true;
  }
  const path = knownHostsPath?.trim();
  if (!path || path.length === 0) {
    return false;
  }
  if (!fs.existsSync(path)) {
    return false;
  }
  const text = fs.readFileSync(path, "utf8");
  const remoteFingerprint = crypto
    .createHash("sha256")
    .update(remoteKey)
    .digest("base64");
  const remoteMarker = `SHA256:${remoteFingerprint}`;
  const hostWithPort = port === 22 ? host : `[${host}]:${port}`;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) {
      continue;
    }
    const hostsField = parts[0] ?? "";
    const keyBody = parts.slice(2).join(" ");
    const hostMatches =
      hostsField === host ||
      hostsField === hostWithPort ||
      hostsField.split(",").includes(host) ||
      hostsField.split(",").includes(hostWithPort);
    if (!hostMatches) {
      continue;
    }
    try {
      const decoded = Buffer.from(keyBody, "base64");
      const lineFingerprint = crypto
        .createHash("sha256")
        .update(decoded)
        .digest("base64");
      if (`SHA256:${lineFingerprint}` === remoteMarker) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
