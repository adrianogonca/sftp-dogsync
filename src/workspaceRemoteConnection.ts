import * as fs from "fs";
import * as vscode from "vscode";
import {
  PRIVATE_KEY_PASSPHRASE_SECRET_KEY_LEGACY,
  deleteSecretWithFallback,
  ftpPasswordSecretKeyEnglish,
  ftpPasswordSecretKeyPortuguese,
  readSecretWithFallback,
  sshPasswordSecretKeyEnglish,
  sshPasswordSecretKeyPortuguese,
  storeSecretMigrating,
} from "./configAliases";
import { SftpConfiguration } from "./configuration";
import { readPrivateKeyFromDisk, ConnectionOptions } from "./sftpClient";
import type { RemoteConnection, FtpConnectionOptions } from "./remoteConnectionTypes";
import { buildConnectionPoolKey } from "./workspaceFolderResolver";

function buildSshSecurityOptions(
  configuration: SftpConfiguration
): Pick<
  ConnectionOptions,
  "strictHostKeyChecking" | "knownHostsPath" | "useSshAgent"
> {
  return {
    strictHostKeyChecking: configuration.strictHostKeyChecking,
    knownHostsPath: configuration.knownHostsPath,
    useSshAgent: configuration.useSshAgent,
  };
}

export const PRIVATE_KEY_PASSPHRASE_SECRET_KEY =
  "sftpSync.privateKeyPassphrase";

export async function readSshPasswordFromVault(
  secrets: vscode.SecretStorage,
  connectionName: string
): Promise<string | undefined> {
  return readSecretWithFallback(
    secrets,
    sshPasswordSecretKeyEnglish(connectionName),
    sshPasswordSecretKeyPortuguese(connectionName)
  );
}

export async function readFtpPasswordFromVault(
  secrets: vscode.SecretStorage,
  connectionName: string
): Promise<string | undefined> {
  return readSecretWithFallback(
    secrets,
    ftpPasswordSecretKeyEnglish(connectionName),
    ftpPasswordSecretKeyPortuguese(connectionName)
  );
}

export async function readPrivateKeyPassphraseFromVault(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  return readSecretWithFallback(
    secrets,
    PRIVATE_KEY_PASSPHRASE_SECRET_KEY,
    PRIVATE_KEY_PASSPHRASE_SECRET_KEY_LEGACY
  );
}

export async function deleteSshPasswordFromVault(
  secrets: vscode.SecretStorage,
  connectionName: string
): Promise<void> {
  await deleteSecretWithFallback(
    secrets,
    sshPasswordSecretKeyEnglish(connectionName),
    sshPasswordSecretKeyPortuguese(connectionName)
  );
}

export async function deleteFtpPasswordFromVault(
  secrets: vscode.SecretStorage,
  connectionName: string
): Promise<void> {
  await deleteSecretWithFallback(
    secrets,
    ftpPasswordSecretKeyEnglish(connectionName),
    ftpPasswordSecretKeyPortuguese(connectionName)
  );
}

export async function deletePrivateKeyPassphraseFromVault(
  secrets: vscode.SecretStorage
): Promise<void> {
  await deleteSecretWithFallback(
    secrets,
    PRIVATE_KEY_PASSPHRASE_SECRET_KEY,
    PRIVATE_KEY_PASSPHRASE_SECRET_KEY_LEGACY
  );
}

export async function storeSshPasswordInVault(
  secrets: vscode.SecretStorage,
  connectionName: string,
  password: string
): Promise<void> {
  await storeSecretMigrating(
    secrets,
    sshPasswordSecretKeyEnglish(connectionName),
    sshPasswordSecretKeyPortuguese(connectionName),
    password
  );
}

export async function storeFtpPasswordInVault(
  secrets: vscode.SecretStorage,
  connectionName: string,
  password: string
): Promise<void> {
  await storeSecretMigrating(
    secrets,
    ftpPasswordSecretKeyEnglish(connectionName),
    ftpPasswordSecretKeyPortuguese(connectionName),
    password
  );
}

export async function storePrivateKeyPassphraseInVault(
  secrets: vscode.SecretStorage,
  passphrase: string
): Promise<void> {
  await storeSecretMigrating(
    secrets,
    PRIVATE_KEY_PASSPHRASE_SECRET_KEY,
    PRIVATE_KEY_PASSPHRASE_SECRET_KEY_LEGACY,
    passphrase
  );
}

async function buildSftpConnectionOptions(
  context: vscode.ExtensionContext,
  configuration: SftpConfiguration
): Promise<ConnectionOptions> {
  if (configuration.sshPasswordAuthentication) {
    const password = await readSshPasswordFromVault(
      context.secrets,
      configuration.connectionName
    );
    if (!password || password.length === 0) {
      throw new Error(
        `Palavra-passe SSH em falta para "${configuration.connectionName}". Comando: DogSync: Definir palavra-passe SSH.`
      );
    }
    return {
      host: configuration.host,
      port: configuration.port,
      username: configuration.username,
      sshPassword: password,
      ...buildSshSecurityOptions(configuration),
    };
  }
  if (configuration.useSshAgent) {
    return {
      host: configuration.host,
      port: configuration.port,
      username: configuration.username,
      useSshAgent: true,
      ...buildSshSecurityOptions(configuration),
    };
  }
  if (!fs.existsSync(configuration.privateKeyPath)) {
    throw new Error(
      `Chave privada não encontrada: ${configuration.privateKeyPath}`
    );
  }
  const keyBuffer = readPrivateKeyFromDisk(configuration.privateKeyPath);
  const passphrase = await readPrivateKeyPassphraseFromVault(context.secrets);
  return {
    host: configuration.host,
    port: configuration.port,
    username: configuration.username,
    privateKeyBuffer: keyBuffer,
    keyPassphrase: passphrase ?? undefined,
    ...buildSshSecurityOptions(configuration),
  };
}

async function buildFtpConnectionOptions(
  context: vscode.ExtensionContext,
  configuration: SftpConfiguration
): Promise<FtpConnectionOptions> {
  const password = await readFtpPasswordFromVault(
    context.secrets,
    configuration.connectionName
  );
  if (!password || password.length === 0) {
    throw new Error(
      `Palavra-passe FTP em falta para "${configuration.connectionName}". Comando: DogSync: Definir palavra-passe FTP.`
    );
  }
  return {
    host: configuration.host,
    port: configuration.port,
    username: configuration.username,
    password,
    ftpSecurityMode: configuration.ftpSecurityMode,
    trustFtpSelfSignedCertificate:
      configuration.trustFtpSelfSignedCertificate,
  };
}

/**
 * Monta a ligação remota (SFTP ou FTP) a partir da configuração e do cofre de segredos.
 */
export async function buildRemoteConnection(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  configuration: SftpConfiguration
): Promise<RemoteConnection> {
  const poolKey = buildConnectionPoolKey(
    workspaceFolder,
    configuration.connectionName
  );
  if (configuration.protocol === "ftp") {
    const options = await buildFtpConnectionOptions(context, configuration);
    return { kind: "ftp", options, poolKey };
  }
  const options = await buildSftpConnectionOptions(context, configuration);
  return { kind: "sftp", options, poolKey };
}

export type { RemoteConnection, FtpConnectionOptions } from "./remoteConnectionTypes";
