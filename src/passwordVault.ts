import * as vscode from "vscode";
import { readConfigurationForConnectionName } from "./configuration";
import {
  deleteFtpPasswordFromVault,
  deleteSshPasswordFromVault,
  readFtpPasswordFromVault,
  readSshPasswordFromVault,
  storeFtpPasswordInVault,
  storeSshPasswordInVault,
} from "./workspaceRemoteConnection";
import { getPrimaryWorkspaceFolder } from "./workspaceFolderResolver";
import {
  readSyncJsonRootFromDisk,
  listConnectionNames,
} from "./syncJsonFile";

/**
 * Callback opcional invocado após alterações no cofre (útil para webviews repintarem o estado).
 */
export type AfterVaultChange = () => void;

/**
 * Mostra o diálogo do cofre para a conexão indicada, escolhendo SSH ou FTP consoante o protocolo.
 * Se a conexão for SFTP por chave privada, informa que não há senha por conexão.
 */
export async function runConnectionPasswordVault(
  context: vscode.ExtensionContext,
  rawConnectionName: string,
  afterChange?: AfterVaultChange
): Promise<void> {
  const connectionName = rawConnectionName.trim();
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(
      "Abra uma pasta do espaço de trabalho primeiro."
    );
    return;
  }
  if (connectionName.length === 0) {
    return;
  }
  const configuration = readConfigurationForConnectionName(
    workspaceFolder,
    connectionName
  );
  if (!configuration) {
    void vscode.window.showErrorMessage(
      `Conexão "${connectionName}" não encontrada no sync.jsonc.`
    );
    return;
  }

  if (configuration.protocol === "ftp") {
    await showFtpPasswordVaultDialog(context, connectionName, afterChange);
    return;
  }

  if (!configuration.sshPasswordAuthentication) {
    void vscode.window.showInformationMessage(
      "Cofre de senha",
      {
        modal: true,
        detail: [
          `Conexão: ${connectionName}`,
          "Esta conexão SFTP usa chave privada.",
          "Não há senha por conexão neste cofre — use o comando da paleta: DogSync: Definir palavra-passe da chave privada (passphrase global).",
        ].join("\n"),
      },
      "OK"
    );
    return;
  }

  await showSshPasswordVaultDialog(context, connectionName, afterChange);
}

/**
 * Árvore do painel: abre campo de senha com texto visível, sempre vazio (nova senha ou substituição).
 */
export async function assignVaultPasswordVisibleField(
  context: vscode.ExtensionContext,
  rawConnectionName: string,
  afterChange?: AfterVaultChange
): Promise<void> {
  const connectionName = rawConnectionName.trim();
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(
      "Abra uma pasta do espaço de trabalho primeiro."
    );
    return;
  }
  if (connectionName.length === 0) {
    return;
  }
  const configuration = readConfigurationForConnectionName(
    workspaceFolder,
    connectionName
  );
  if (!configuration) {
    void vscode.window.showErrorMessage(
      `Conexão "${connectionName}" não encontrada no sync.jsonc.`
    );
    return;
  }

  if (configuration.protocol === "ftp") {
    await promptAndStoreFtpPasswordInVault(context, connectionName, afterChange);
    return;
  }

  if (!configuration.sshPasswordAuthentication) {
    void vscode.window.showInformationMessage(
      "Cofre de senha",
      {
        modal: true,
        detail: [
          `Conexão: ${connectionName}`,
          "Esta conexão SFTP usa chave privada.",
          "Não há senha por conexão neste cofre — use o comando da paleta: DogSync: Definir palavra-passe da chave privada (passphrase global).",
        ].join("\n"),
      },
      "OK"
    );
    return;
  }

  await promptAndStoreSshPasswordInVault(context, connectionName, afterChange);
}

/**
 * Remove do cofre a senha SSH ou FTP associada ao nome da conexão.
 */
export async function removeConnectionVaultPassword(
  context: vscode.ExtensionContext,
  rawConnectionName: string,
  afterChange?: AfterVaultChange
): Promise<void> {
  const connectionName = rawConnectionName.trim();
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder || connectionName.length === 0) {
    return;
  }
  const configuration = readConfigurationForConnectionName(
    workspaceFolder,
    connectionName
  );
  if (!configuration) {
    void vscode.window.showErrorMessage(
      `Conexão "${connectionName}" não encontrada no sync.jsonc.`
    );
    return;
  }
  if (configuration.protocol === "ftp") {
    await deleteFtpPasswordFromVault(context.secrets, connectionName);
    void vscode.window.showInformationMessage(
      `Senha FTP removida do cofre para "${connectionName}".`
    );
    afterChange?.();
    return;
  }
  if (!configuration.sshPasswordAuthentication) {
    void vscode.window.showWarningMessage(
      `A conexão "${connectionName}" não usa senha SSH no cofre (chave privada).`
    );
    return;
  }
  await deleteSshPasswordFromVault(context.secrets, connectionName);
  void vscode.window.showInformationMessage(
    `Senha SSH removida do cofre para "${connectionName}".`
  );
  afterChange?.();
}

/**
 * Pede escolha de conexão (ou usa a única existente) e abre o diálogo do cofre.
 */
export async function chooseConnectionAndOpenPasswordVault(
  context: vscode.ExtensionContext,
  afterChange?: AfterVaultChange
): Promise<void> {
  const folder = getPrimaryWorkspaceFolder();
  if (!folder) {
    void vscode.window.showErrorMessage(
      "Abra uma pasta do espaço de trabalho primeiro."
    );
    return;
  }
  const root = readSyncJsonRootFromDisk(folder);
  const names = listConnectionNames(root);
  if (names.length === 0) {
    void vscode.window.showErrorMessage(
      "Crie uma conexão em .vscode/sync.jsonc primeiro."
    );
    return;
  }
  let chosenName: string | undefined = names[0];
  if (names.length > 1) {
    const choice = await vscode.window.showQuickPick(names, {
      title: "Cofre de senha — escolha a conexão",
      placeHolder: "Conexão a gerir no cofre",
    });
    if (!choice) {
      return;
    }
    chosenName = choice;
  }
  if (chosenName) {
    await assignVaultPasswordVisibleField(context, chosenName, afterChange);
  }
}

async function showFtpPasswordVaultDialog(
  context: vscode.ExtensionContext,
  connectionName: string,
  afterChange?: AfterVaultChange
): Promise<void> {
  const value = await readFtpPasswordFromVault(
    context.secrets,
    connectionName
  );
  const hasPassword = Boolean(value && value.length > 0);
  const statusLine = hasPassword
    ? "Senha FTP no cofre: ***"
    : "Senha FTP no cofre: (vazio)";
  const choice = await vscode.window.showInformationMessage(
    "Cofre de senha",
    {
      modal: true,
      detail: [
        `Conexão: ${connectionName}`,
        "Protocolo: FTP",
        statusLine,
      ].join("\n"),
    },
    "Salvar ou alterar",
    "Remover do cofre"
  );
  if (choice === "Salvar ou alterar") {
    await promptAndStoreFtpPasswordInVault(context, connectionName, afterChange);
  } else if (choice === "Remover do cofre") {
    await deleteFtpPasswordFromVault(context.secrets, connectionName);
    void vscode.window.showInformationMessage(
      `Senha FTP removida para "${connectionName}".`
    );
    afterChange?.();
  }
}

async function showSshPasswordVaultDialog(
  context: vscode.ExtensionContext,
  connectionName: string,
  afterChange?: AfterVaultChange
): Promise<void> {
  const value = await readSshPasswordFromVault(
    context.secrets,
    connectionName
  );
  const hasPassword = Boolean(value && value.length > 0);
  const statusLine = hasPassword
    ? "Senha SSH no cofre: ***"
    : "Senha SSH no cofre: (vazio)";
  const choice = await vscode.window.showInformationMessage(
    "Cofre de senha",
    {
      modal: true,
      detail: [
        `Conexão: ${connectionName}`,
        "Protocolo: SFTP (utilizador + senha)",
        statusLine,
      ].join("\n"),
    },
    "Salvar ou alterar",
    "Remover do cofre"
  );
  if (choice === "Salvar ou alterar") {
    await promptAndStoreSshPasswordInVault(context, connectionName, afterChange);
  } else if (choice === "Remover do cofre") {
    await deleteSshPasswordFromVault(context.secrets, connectionName);
    void vscode.window.showInformationMessage(
      `Senha SSH removida para "${connectionName}".`
    );
    afterChange?.();
  }
}

async function promptAndStoreFtpPasswordInVault(
  context: vscode.ExtensionContext,
  connectionName: string,
  afterChange?: AfterVaultChange
): Promise<void> {
  const passwordInput = await vscode.window.showInputBox({
    title: `Senha FTP — ${connectionName}`,
    password: true,
    value: "",
    ignoreFocusOut: true,
    prompt:
      "Digite a senha. O campo começa vazio mesmo se já existir senha guardada. Deixe vazio para cancelar.",
  });
  if (passwordInput === undefined || passwordInput.length === 0) {
    return;
  }
  await storeFtpPasswordInVault(
    context.secrets,
    connectionName,
    passwordInput
  );
  void vscode.window.showInformationMessage(
    `Senha FTP guardada para "${connectionName}" (não vai para o JSON).`
  );
  afterChange?.();
}

async function promptAndStoreSshPasswordInVault(
  context: vscode.ExtensionContext,
  connectionName: string,
  afterChange?: AfterVaultChange
): Promise<void> {
  const passwordInput = await vscode.window.showInputBox({
    title: `Senha SSH — ${connectionName}`,
    password: true,
    value: "",
    ignoreFocusOut: true,
    prompt:
      "Digite a senha. O campo começa vazio mesmo se já existir senha guardada. Deixe vazio para cancelar.",
  });
  if (passwordInput === undefined || passwordInput.length === 0) {
    return;
  }
  await storeSshPasswordInVault(
    context.secrets,
    connectionName,
    passwordInput
  );
  void vscode.window.showInformationMessage(
    `Senha SSH guardada para "${connectionName}" (não vai para o JSON).`
  );
  afterChange?.();
}
