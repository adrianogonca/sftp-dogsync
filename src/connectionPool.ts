import { Client, SFTPWrapper } from "ssh2";
import { Client as FtpClient } from "basic-ftp";
import type { ConnectionOptions } from "./sftpClient";
import type { FtpConnectionOptions } from "./remoteConnectionTypes";
import { verifyKnownHostKey } from "./knownHosts";
import { buildBasicFtpAccessOptions } from "./ftpConnectionHelpers";
import { logLine } from "./logger";

const IDLE_CLOSE_MS = 45_000;

interface SftpPoolEntry {
  client: Client;
  sftp: SFTPWrapper;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  chain: Promise<unknown>;
}

interface FtpPoolEntry {
  client: FtpClient;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  chain: Promise<unknown>;
}

const sftpPools = new Map<string, SftpPoolEntry>();
const ftpPools = new Map<string, FtpPoolEntry>();

function buildSshConnectConfig(options: ConnectionOptions): Record<string, unknown> {
  const base = {
    host: options.host,
    port: options.port,
    username: options.username,
    readyTimeout: 20000,
    hostVerifier: (hashedKey: Buffer) =>
      verifyKnownHostKey(
        options.host,
        options.port,
        hashedKey,
        options.knownHostsPath,
        Boolean(options.strictHostKeyChecking)
      ),
  };
  if (options.useSshAgent) {
    const agentPath = process.env.SSH_AUTH_SOCK;
    if (!agentPath || agentPath.length === 0) {
      throw new Error(
        "useSshAgent ativo mas SSH_AUTH_SOCK não está definido (agente SSH indisponível)."
      );
    }
    return { ...base, agent: agentPath };
  }
  const sshPassword = options.sshPassword;
  if (sshPassword !== undefined && sshPassword.length > 0) {
    return { ...base, password: sshPassword };
  }
  return {
    ...base,
    privateKey: options.privateKeyBuffer,
    passphrase: options.keyPassphrase,
  };
}

function promiseConnect(client: Client, options: ConnectionOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const connection = buildSshConnectConfig(options);
    if (
      !options.useSshAgent &&
      !("password" in connection) &&
      !connection.privateKey
    ) {
      reject(new Error("Configuração de autenticação SSH inválida."));
      return;
    }
    client.connect(connection);
    client.once("ready", () => resolve());
    client.once("error", (error: Error) => reject(error));
  });
}

function promiseGetSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(sftp);
    });
  });
}

function scheduleSftpIdleClose(poolKey: string, entry: SftpPoolEntry): void {
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    void disposeSftpPoolEntry(poolKey);
  }, IDLE_CLOSE_MS);
}

function scheduleFtpIdleClose(poolKey: string, entry: FtpPoolEntry): void {
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    void disposeFtpPoolEntry(poolKey);
  }, IDLE_CLOSE_MS);
}

async function disposeSftpPoolEntry(poolKey: string): Promise<void> {
  const entry = sftpPools.get(poolKey);
  if (!entry) {
    return;
  }
  sftpPools.delete(poolKey);
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
  }
  try {
    entry.client.end();
  } catch {
    /* ignorar */
  }
}

async function disposeFtpPoolEntry(poolKey: string): Promise<void> {
  const entry = ftpPools.get(poolKey);
  if (!entry) {
    return;
  }
  ftpPools.delete(poolKey);
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
  }
  try {
    entry.client.close();
  } catch {
    /* ignorar */
  }
}

async function ensureSftpEntry(
  poolKey: string,
  options: ConnectionOptions
): Promise<SftpPoolEntry> {
  const existing = sftpPools.get(poolKey);
  if (existing) {
    scheduleSftpIdleClose(poolKey, existing);
    return existing;
  }
  const client = new Client();
  await promiseConnect(client, options);
  const sftp = await promiseGetSftp(client);
  const entry: SftpPoolEntry = {
    client,
    sftp,
    idleTimer: undefined,
    chain: Promise.resolve(),
  };
  client.on("close", () => {
    if (sftpPools.get(poolKey) === entry) {
      sftpPools.delete(poolKey);
    }
  });
  client.on("error", () => {
    void disposeSftpPoolEntry(poolKey);
  });
  sftpPools.set(poolKey, entry);
  scheduleSftpIdleClose(poolKey, entry);
  return entry;
}

async function ensureFtpEntry(
  poolKey: string,
  options: FtpConnectionOptions
): Promise<FtpPoolEntry> {
  const existing = ftpPools.get(poolKey);
  if (existing) {
    scheduleFtpIdleClose(poolKey, existing);
    return existing;
  }
  const client = new FtpClient(45000);
  const accessOpts = buildBasicFtpAccessOptions(options);
  await client.access(accessOpts);
  const entry: FtpPoolEntry = {
    client,
    idleTimer: undefined,
    chain: Promise.resolve(),
  };
  ftpPools.set(poolKey, entry);
  scheduleFtpIdleClose(poolKey, entry);
  return entry;
}

export async function withPooledSftp<T>(
  poolKey: string,
  options: ConnectionOptions,
  work: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  let entry = await ensureSftpEntry(poolKey, options);
  const run = async (): Promise<T> => {
    try {
      entry = await ensureSftpEntry(poolKey, options);
      scheduleSftpIdleClose(poolKey, entry);
      return await work(entry.sftp);
    } catch (error) {
      await disposeSftpPoolEntry(poolKey);
      throw error;
    }
  };
  const result = entry.chain.then(run, run);
  entry.chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function withPooledFtp<T>(
  poolKey: string,
  options: FtpConnectionOptions,
  work: (client: FtpClient) => Promise<T>
): Promise<T> {
  let entry = await ensureFtpEntry(poolKey, options);
  const run = async (): Promise<T> => {
    try {
      entry = await ensureFtpEntry(poolKey, options);
      scheduleFtpIdleClose(poolKey, entry);
      return await work(entry.client);
    } catch (error) {
      await disposeFtpPoolEntry(poolKey);
      throw error;
    }
  };
  const result = entry.chain.then(run, run);
  entry.chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function disposeAllConnectionPools(): void {
  for (const key of [...sftpPools.keys()]) {
    void disposeSftpPoolEntry(key);
  }
  for (const key of [...ftpPools.keys()]) {
    void disposeFtpPoolEntry(key);
  }
}

export async function testPooledConnection(
  poolKey: string,
  connection: import("./remoteConnectionTypes").RemoteConnection
): Promise<void> {
  if (connection.kind === "sftp") {
    await withPooledSftp(poolKey, connection.options, async (sftp) => {
      await new Promise<void>((resolve, reject) => {
        sftp.readdir(".", (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
    logLine(`Teste de ligação SFTP OK (${poolKey}).`);
    return;
  }
  await withPooledFtp(poolKey, connection.options, async (client) => {
    await client.list(".");
  });
  logLine(`Teste de ligação FTP OK (${poolKey}).`);
}
