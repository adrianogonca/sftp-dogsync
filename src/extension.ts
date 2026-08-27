import * as path from "path";
import * as vscode from "vscode";
import {
  posixRelativePath,
  isRemotePathDescendantOfRoot,
  shouldIgnorePath,
  joinRemote,
  normalizeRemotePosixPath,
} from "./paths";
import {
  isMinimumConfigurationFilled,
  readConfiguration,
  readConfigurationForConnectionName,
  resolveAbsoluteLocalRoot,
} from "./configuration";
import {
  downloadRemoteToLocal,
  deleteRemotePath,
  uploadLocalPathToRemoteRecursive,
  uploadLocalFileToRemote,
} from "./remoteClient";
import {
  deleteFtpPasswordFromVault,
  deletePrivateKeyPassphraseFromVault,
  deleteSshPasswordFromVault,
  storeFtpPasswordInVault,
  storePrivateKeyPassphraseInVault,
  storeSshPasswordInVault,
  buildRemoteConnection,
} from "./workspaceRemoteConnection";
import { PORTUGUESE_COMMAND_ALIASES } from "./configAliases";
import { initializeStatusBar, setStatus } from "./statusBar";
import { setPanelStatePortrait } from "./panelStatePortrait";
import { synchronizeConfigurationIntroState } from "./configurationIntro";
import { migrateAllWorkspaceLegacySettings } from "./legacySettingsMigration";
import {
  resolveWorkspaceFolderForAbsolutePath,
  getPrimaryWorkspaceFolder,
  buildConnectionPoolKey,
} from "./workspaceFolderResolver";
import { scheduleDebouncedUpload, flushUploadQueues } from "./uploadQueue";
import { disposeAllConnectionPools, testPooledConnection } from "./connectionPool";
import {
  readSyncJsonStructureFromDisk,
  listConnectionNames,
  getFirstConnectionNameInDeclaredOrder,
} from "./syncJsonFile";
import { SyncTreeProvider, TREE_VIEW_ID } from "./syncTreeProvider";
import {
  assignVaultPasswordVisibleField,
  chooseConnectionAndOpenPasswordVault,
  removeConnectionVaultPassword,
} from "./passwordVault";
import { showChannel, logError, logLine } from "./logger";
import {
  getOpenRemoteFileMetadata,
  removeRemoteFileRecord,
} from "./remoteEditorTracking";

/**
 * activate síncrono: o Cursor/VS Code regista o TreeDataProvider antes de qualquer await,
 * evitando o erro «no data provider» quando a vista abre no arranque.
 */
export function activate(context: vscode.ExtensionContext): void {
  /**
   * Registo antes do resto da ativação: se `ativarExtensao` falhar, o utilizador ainda pode
   * executar este comando pela paleta (não resolve o aviso nativo «no data provider», que é
   * do host, mas permite recarregar a janela sem depender da árvore).
   */
  context.subscriptions.push(
    vscode.commands.registerCommand("sftpSync.reloadEditorWindow", () => {
      void vscode.commands.executeCommand("workbench.action.reloadWindow");
    })
  );

  try {
    activateExtension(context);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    const stack =
      error instanceof Error ? error.stack ?? message : message;
    console.error("DogSync: falha na ativação", error);
    void vscode.window.showErrorMessage(
      `DogSync: falha na ativação (${message}). Use «DogSync: Recarregar janela do editor» na paleta ou o botão na barra de estado.`
    );
    try {
      const channel = vscode.window.createOutputChannel("DogSync");
      channel.appendLine(stack);
      channel.show(true);
    } catch {
      /* evitar falha em cascata */
    }
    try {
      const reloadItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        102
      );
      reloadItem.name = "DogSync — recuperação";
      reloadItem.text = "$(refresh) DogSync: recarregar janela";
      reloadItem.tooltip =
        "A ativação da extensão falhou. Clique para recarregar o Cursor/VS Code e tentar de novo.";
      reloadItem.command = "sftpSync.reloadEditorWindow";
      reloadItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
      reloadItem.show();
      context.subscriptions.push(reloadItem);
    } catch {
      /* ignorar */
    }
  }
}

function activateExtension(context: vscode.ExtensionContext): void {
  migrateAllWorkspaceLegacySettings();

  const treeProvider = new SyncTreeProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(TREE_VIEW_ID, treeProvider)
  );

  initializeStatusBar(context);

  const startupFolderCount =
    vscode.workspace.workspaceFolders?.length ?? 0;
  logLine(
    `Extensão ativada (workspaceFolders=${startupFolderCount}).`
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const caminho = doc.uri.fsPath;
      if (
        caminho.endsWith(`${path.sep}.vscode${path.sep}sync.jsonc`) ||
        caminho.endsWith(`${path.sep}.vscode${path.sep}sync.json`)
      ) {
        treeProvider.refresh();
      }
    })
  );

  synchronizeConfigurationIntroState(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      synchronizeConfigurationIntroState(context);
      treeProvider.refresh();
      void updateInitialStatusBar();
    })
  );

  /* Dois padrões explícitos: alguns hosts não expandem chaves em globs do watcher. */
  const syncJsoncWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.vscode/sync.jsonc"
  );
  const legacySyncJsonWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.vscode/sync.json"
  );
  const onSyncJsoncChange = (): void => {
    treeProvider.refresh();
    synchronizeConfigurationIntroState(context);
    void updateInitialStatusBar();
  };
  context.subscriptions.push(
    syncJsoncWatcher,
    syncJsoncWatcher.onDidCreate(onSyncJsoncChange),
    syncJsoncWatcher.onDidChange(onSyncJsoncChange),
    syncJsoncWatcher.onDidDelete(onSyncJsoncChange),
    legacySyncJsonWatcher,
    legacySyncJsonWatcher.onDidCreate(onSyncJsoncChange),
    legacySyncJsonWatcher.onDidChange(onSyncJsoncChange),
    legacySyncJsonWatcher.onDidDelete(onSyncJsoncChange)
  );

  setTimeout(() => {
    treeProvider.refresh();
    void updateInitialStatusBar();
  }, 0);

  context.subscriptions.push(
    vscode.commands.registerCommand("sftpSync.showLog", () => {
      showChannel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sftpSync.addConnection", () => {
      void treeProvider.addConnection();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sftpSync.openSyncJson", () => {
      void treeProvider.openSyncJsonc();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sftpSync.openPasswordVault", () => {
      void chooseConnectionAndOpenPasswordVault(context, () =>
        treeProvider.refresh()
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.setVaultPasswordFromTree",
      (connectionName: string) => {
        if (typeof connectionName === "string" && connectionName.trim().length > 0) {
          void assignVaultPasswordVisibleField(context, connectionName, () =>
            treeProvider.refresh()
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.removeVaultPasswordFromTree",
      (arg: vscode.TreeItem) => {
        const id =
          arg &&
          typeof arg === "object" &&
          "id" in arg &&
          typeof arg.id === "string"
            ? arg.id
            : "";
        if (!id.startsWith("vault||")) {
          return;
        }
        const name = id.slice("vault||".length);
        if (name.length > 0) {
          void removeConnectionVaultPassword(context, name, () =>
            treeProvider.refresh()
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.setDefaultConnection",
      (arg: vscode.TreeItem | string) => {
        const name =
          typeof arg === "string"
            ? arg
            : arg?.id && typeof arg.id === "string"
              ? arg.id
              : "";
        if (name) {
          void treeProvider.setDefaultConnection(name);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.openSyncJsonEmConexao",
      (arg: vscode.TreeItem) => {
        const name = arg?.id && typeof arg.id === "string" ? arg.id : "";
        if (name) {
          void treeProvider.openSyncJsoncAtConnection(name);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.removeConnectionFromSyncJsonc",
      (arg: vscode.TreeItem) => {
        const name = arg?.id && typeof arg.id === "string" ? arg.id : "";
        if (name) {
          void treeProvider.removeConnectionFromSyncJsonc(name);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.openRemoteInEditor",
      (arg1: string | vscode.TreeItem, arg2?: string) => {
        let connectionName: string;
        let remotePath: string;
        if (typeof arg1 === "string" && typeof arg2 === "string") {
          connectionName = arg1;
          remotePath = arg2;
        } else if (arg1 && typeof arg1 === "object" && "id" in arg1) {
          const parts = (arg1 as vscode.TreeItem).id?.split("||") ?? [];
          if (parts.length >= 2) {
            connectionName = parts[0];
            remotePath = parts[1];
          } else {
            return;
          }
        } else {
          return;
        }
        if (connectionName && remotePath) {
          void treeProvider.openRemoteInEditor(connectionName, remotePath);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.deleteRemote",
      (arg: vscode.TreeItem) => {
        const id = arg?.id && typeof arg.id === "string" ? arg.id : "";
        const parts = id.split("||");
        if (parts.length >= 3) {
          const [connectionName, remotePath] = parts;
          const isDirectory = parts[2] === "true";
          void treeProvider.deleteRemote(
            connectionName,
            remotePath,
            isDirectory
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.downloadRemoteFromPanel",
      (arg: vscode.TreeItem) => {
        const id = arg?.id && typeof arg.id === "string" ? arg.id : "";
        const parts = id.split("||");
        if (parts.length >= 3) {
          const [connectionName, remotePath] = parts;
          const isDirectory = parts[2] === "true";
          void treeProvider.downloadRemoteToWorkspace(
            connectionName,
            remotePath,
            isDirectory
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.setPrivateKeyPassphrase",
      async () => {
        const entry = await vscode.window.showInputBox({
          title: "Palavra-passe da chave privada SSH",
          password: true,
          ignoreFocusOut: true,
          prompt:
            "Deixe vazio para limpar a palavra-passe guardada (chave sem passphrase).",
        });
        if (entry === undefined) {
          return;
        }
        if (entry === "") {
          await deletePrivateKeyPassphraseFromVault(context.secrets);
          vscode.window.showInformationMessage(
            "Palavra-passe da chave removida do armazenamento seguro."
          );
          return;
        }
        await storePrivateKeyPassphraseInVault(context.secrets, entry);
        vscode.window.showInformationMessage(
          "Palavra-passe da chave guardada de forma segura."
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.setFtpPassword",
      async () => {
        const folder = getPrimaryWorkspaceFolder();
        if (!folder) {
          void vscode.window.showErrorMessage(
            "Abra uma pasta no espaço de trabalho."
          );
          return;
        }
        const readResult = readSyncJsonStructureFromDisk(folder);
        const names = listConnectionNames(readResult.connections);
        if (names.length === 0) {
          void vscode.window.showErrorMessage(
            "Crie uma conexão em .vscode/sync.jsonc primeiro."
          );
          return;
        }
        const defaultName = getFirstConnectionNameInDeclaredOrder(
          readResult.connections
        );
        let chosenName = defaultName;
        if (names.length > 1) {
          const choice = await vscode.window.showQuickPick(
            names.map((name) => ({
              label: name,
              description:
                name === defaultName ? "primeira no sync.jsonc" : undefined,
            })),
            {
              title: "Conexão para a palavra-passe FTP",
              placeHolder: defaultName,
            }
          );
          if (!choice) {
            return;
          }
          chosenName = choice.label;
        }
        const connectionConfiguration = readConfigurationForConnectionName(
          folder,
          chosenName
        );
        if (
          !connectionConfiguration ||
          connectionConfiguration.protocol !== "ftp"
        ) {
          void vscode.window.showErrorMessage(
            `A conexão "${chosenName}" não está em modo FTP (protocolo: "ftp" no sync.jsonc).`
          );
          return;
        }
        const ftpPasswordInput = await vscode.window.showInputBox({
          title: `Palavra-passe FTP — ${chosenName}`,
          password: true,
          ignoreFocusOut: true,
          prompt:
            "Palavra-passe da conta FTP. Vazio para remover do cofre.",
        });
        if (ftpPasswordInput === undefined) {
          return;
        }
        if (ftpPasswordInput === "") {
          await deleteFtpPasswordFromVault(context.secrets, chosenName);
          void vscode.window.showInformationMessage(
            `Palavra-passe FTP removida para "${chosenName}".`
          );
          return;
        }
        await storeFtpPasswordInVault(
          context.secrets,
          chosenName,
          ftpPasswordInput
        );
        void vscode.window.showInformationMessage(
          `Palavra-passe FTP guardada para "${chosenName}" (não fica no ficheiro de sync).`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.setSshPassword",
      async () => {
        const folder = getPrimaryWorkspaceFolder();
        if (!folder) {
          void vscode.window.showErrorMessage(
            "Abra uma pasta no espaço de trabalho."
          );
          return;
        }
        const readResult = readSyncJsonStructureFromDisk(folder);
        const names = listConnectionNames(readResult.connections);
        if (names.length === 0) {
          void vscode.window.showErrorMessage(
            "Crie uma conexão em .vscode/sync.jsonc primeiro."
          );
          return;
        }
        const defaultName = getFirstConnectionNameInDeclaredOrder(
          readResult.connections
        );
        let chosenName = defaultName;
        if (names.length > 1) {
          const choice = await vscode.window.showQuickPick(
            names.map((name) => ({
              label: name,
              description:
                name === defaultName ? "primeira no sync.jsonc" : undefined,
            })),
            {
              title: "Conexão para a palavra-passe SSH",
              placeHolder: defaultName,
            }
          );
          if (!choice) {
            return;
          }
          chosenName = choice.label;
        }
        const connectionConfiguration = readConfigurationForConnectionName(
          folder,
          chosenName
        );
        if (
          connectionConfiguration &&
          connectionConfiguration.protocol === "ftp"
        ) {
          void vscode.window.showErrorMessage(
            `A conexão "${chosenName}" usa FTP. Use o comando DogSync: Definir palavra-passe FTP.`
          );
          return;
        }
        const passwordInput = await vscode.window.showInputBox({
          title: `Palavra-passe SSH — ${chosenName}`,
          password: true,
          ignoreFocusOut: true,
          prompt:
            "Palavra-passe do utilizador no servidor. Vazio para remover do cofre.",
        });
        if (passwordInput === undefined) {
          return;
        }
        if (passwordInput === "") {
          await deleteSshPasswordFromVault(context.secrets, chosenName);
          void vscode.window.showInformationMessage(
            `Palavra-passe SSH removida para "${chosenName}".`
          );
          return;
        }
        await storeSshPasswordInVault(
          context.secrets,
          chosenName,
          passwordInput
        );
        void vscode.window.showInformationMessage(
          `Palavra-passe SSH guardada para "${chosenName}" (não fica no ficheiro de sync).`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.uploadCurrentFile",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== "file") {
          vscode.window.showWarningMessage(
            "Abra um ficheiro guardado no disco para enviar."
          );
          return;
        }
        await runDocumentUpload(
          context,
          editor.document,
          "manual_command"
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.downloadPath",
      async (receivedUri?: unknown, selectedUris?: unknown) => {
        const target = resolveExplorerFileUri(receivedUri, selectedUris);
        if (!target) {
          vscode.window.showWarningMessage(
            "Selecione um ficheiro ou pasta no explorador, ou abra um ficheiro no editor."
          );
          return;
        }
        await runDownload(context, target);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sftpSync.uploadPath",
      async (receivedUri?: unknown, selectedUris?: unknown) => {
        const targets = resolveExplorerFileUris(receivedUri, selectedUris);
        if (targets.length === 0) {
          vscode.window.showWarningMessage(
            "Selecione um ficheiro ou pasta no explorador, ou abra um ficheiro no editor."
          );
          return;
        }
        for (const target of targets) {
          await runPathUpload(context, target);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (documento) => {
      if (documento.uri.scheme !== "file") {
        return;
      }
      await runDocumentUpload(context, documento, "save");
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((documento) => {
      if (documento.uri.scheme === "file") {
        removeRemoteFileRecord(documento.uri.fsPath);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles((event) => {
      void runRemoteDeleteAfterLocalDelete(
        context,
        event,
        treeProvider
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("sftpSync")) {
        await updateInitialStatusBar();
      }
    })
  );

  void updateInitialStatusBar();
  registerPortugueseCommandAliases(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("sftpSync.testConnection", () => {
      void runTestConnection(context);
    })
  );
}

async function runTestConnection(
  context: vscode.ExtensionContext
): Promise<void> {
  const folder = getPrimaryWorkspaceFolder();
  if (!folder) {
    void vscode.window.showErrorMessage(
      "Abra uma pasta no espaço de trabalho."
    );
    return;
  }
  const readResult = readSyncJsonStructureFromDisk(folder);
  const names = listConnectionNames(readResult.connections);
  if (names.length === 0) {
    void vscode.window.showErrorMessage(
      "Configure uma conexão em .vscode/sync.jsonc."
    );
    return;
  }
  let chosenName = getFirstConnectionNameInDeclaredOrder(readResult.connections);
  if (names.length > 1) {
    const picked = await vscode.window.showQuickPick(names, {
      title: "DogSync: testar ligação",
      placeHolder: "Escolha a conexão",
    });
    if (!picked) {
      return;
    }
    chosenName = picked;
  }
  const configuration = readConfigurationForConnectionName(folder, chosenName);
  if (!configuration || !isMinimumConfigurationFilled(configuration)) {
    void vscode.window.showErrorMessage(
      `Conexão "${chosenName}" incompleta no sync.jsonc.`
    );
    return;
  }
  setStatus("syncing", `A testar ligação "${chosenName}"…`);
  try {
    const connection = await buildRemoteConnection(
      context,
      folder,
      configuration
    );
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `DogSync: a testar "${chosenName}"…`,
        cancellable: false,
      },
      () => testPooledConnection(connection.poolKey, connection)
    );
    setStatus("ready", `Ligação OK: ${chosenName}`);
    void vscode.window.showInformationMessage(
      `DogSync: ligação "${chosenName}" OK.`
    );
  } catch (error) {
    logError(`Teste de ligação (${chosenName})`, error);
    setStatus("error", `Falha no teste: ${chosenName}`);
    void vscode.window.showErrorMessage(
      `DogSync: falha ao testar "${chosenName}". Veja o registo.`
    );
  }
}

function registerPortugueseCommandAliases(
  context: vscode.ExtensionContext
): void {
  for (const [portugueseId, englishId] of PORTUGUESE_COMMAND_ALIASES) {
    context.subscriptions.push(
      vscode.commands.registerCommand(portugueseId, (...args: unknown[]) =>
        vscode.commands.executeCommand(englishId, ...args)
      )
    );
  }
}

async function updateInitialStatusBar(): Promise<void> {
  const folder = getPrimaryWorkspaceFolder();
  if (!folder) {
    setPanelStatePortrait({
      host: "",
      port: 22,
      username: "",
      remoteRoot: "",
    });
    setStatus("inactive", "Sem espaço de trabalho aberto.");
    return;
  }
  const configuration = readConfiguration(folder);
  setPanelStatePortrait({
    host: configuration.host,
    port: configuration.port,
    username: configuration.username,
    remoteRoot: configuration.remoteRoot,
  });
  if (!configuration.enabled) {
    setStatus("inactive", "sftpSync.enabled está desligado.");
    return;
  }
  if (!isMinimumConfigurationFilled(configuration)) {
    setStatus(
      "unconfigured",
      "Preencha servidor, utilizador, raiz remota. SFTP: chave ou senha SSH (comando Definir palavra-passe SSH). FTP: \"protocolo\": \"ftp\", porta, comando Definir palavra-passe FTP."
    );
    return;
  }
  setStatus("ready", "Clique para ver o registo DogSync.");
}

async function runDocumentUpload(
  context: vscode.ExtensionContext,
  documento: vscode.TextDocument,
  origin: "save" | "manual_command"
): Promise<void> {
  const filePath = documento.uri.fsPath;
  const remoteMeta = getOpenRemoteFileMetadata(filePath);
  if (remoteMeta !== undefined) {
    const workspaceFolder = resolveWorkspaceFolderForAbsolutePath(filePath);
    if (!workspaceFolder) {
      logLine(
        `Pré-visualização remota não enviada: abra uma pasta no espaço de trabalho. (${filePath})`
      );
      void vscode.window.showWarningMessage(
        "DogSync: com uma pasta aberta no espaço de trabalho, o guardar volta a enviar ficheiros abertos pelo painel remoto."
      );
      return;
    }
    const configuration = readConfigurationForConnectionName(
      workspaceFolder,
      remoteMeta.connectionName
    );
    if (!configuration || !isMinimumConfigurationFilled(configuration)) {
      const msg = `Não é possível enviar: a conexão "${remoteMeta.connectionName}" não existe ou está incompleta no sync.`;
      logLine(msg);
      setStatus("error", msg);
      void vscode.window.showWarningMessage(msg);
      return;
    }
    if (!configuration.enabled) {
      const msg = `sftpSync.enabled desligado; não foi enviado para "${remoteMeta.connectionName}".`;
      logLine(msg);
      if (origin === "manual_command") {
        void vscode.window.showWarningMessage(msg);
      } else {
        setStatus(
          "ready",
          "Extensão inativa (sftpSync.enabled) — guardou só no temp local."
        );
      }
      return;
    }
    if (origin === "save" && !configuration.uploadOnSave) {
      const msg = `uploadAoGuardar desligado na conexão "${remoteMeta.connectionName}" — só gravou no temp local; remoto não foi alterado.`;
      logLine(msg);
      setStatus(
        "ready",
        `Guardar: só local (ligue uploadAoGuardar em "${remoteMeta.connectionName}" ou use Enviar ficheiro atual)`
      );
      return;
    }
    const fileName =
      filePath.replace(/^.*[/\\]/, "") || remoteMeta.remotePosixPath;
    setStatus(
      "syncing",
      `A guardar ${fileName} → ${remoteMeta.connectionName}`
    );
    const doUpload = async (): Promise<void> => {
      try {
        const connection = await buildRemoteConnection(
          context,
          workspaceFolder,
          configuration
        );
        await uploadLocalFileToRemote(
          connection,
          filePath,
          remoteMeta.remotePosixPath
        );
        logLine(
          `Guardado no remoto [${remoteMeta.connectionName}]: ${remoteMeta.remotePosixPath}`
        );
        setStatus(
          "ready",
          `Último envio: ${remoteMeta.connectionName} — ${fileName}`
        );
      } catch (error) {
        logError("Falha ao enviar ficheiro remoto (pré-visualização)", error);
        setStatus(
          "error",
          `Falha ao enviar para "${remoteMeta.connectionName}"; veja o registo.`
        );
        void vscode.window.showErrorMessage(
          `Falha ao enviar para a conexão "${remoteMeta.connectionName}". Veja o registo DogSync.`
        );
      }
    };
    if (origin === "save") {
      await scheduleDebouncedUpload(
        filePath,
        buildConnectionPoolKey(workspaceFolder, configuration.connectionName),
        doUpload
      );
    } else {
      await doUpload();
    }
    return;
  }

  if (
    remoteMeta === undefined &&
    filePath.includes(
      path.join("sftp-sync-vps-preview") + path.sep
    )
  ) {
    logLine(
      "DogSync: ficheiro no temp de pré-visualização sem registo para envio — reabra pelo painel remoto (ligação Conectar → árvore)."
    );
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documento.uri);
  if (!workspaceFolder) {
    return;
  }
  const configuration = readConfiguration(workspaceFolder);
  if (!configuration.enabled || !isMinimumConfigurationFilled(configuration)) {
    if (origin === "manual_command") {
      vscode.window.showErrorMessage(
        "Configure a ligação (definições do espaço de trabalho)."
      );
    }
    return;
  }
  if (origin === "save" && !configuration.uploadOnSave) {
    return;
  }
  const raizLocal = resolveAbsoluteLocalRoot(workspaceFolder, configuration);
  const relative = posixRelativePath(filePath, raizLocal);
  if (relative === undefined) {
    logLine(
      `Ignorado (fora da raiz local mapeada): ${filePath}`
    );
    return;
  }
  if (shouldIgnorePath(relative, configuration.ignorePatterns)) {
    logLine(`Ignorado (padrão): ${relative}`);
    return;
  }
  const remoto = joinRemote(configuration.remoteRoot, relative);
  const shortLocalName =
    filePath.replace(/^.*[/\\]/, "") || relative;
  setStatus(
    "syncing",
    `A enviar ${shortLocalName} → ${configuration.connectionName}`
  );
  const doUpload = async (): Promise<void> => {
    try {
      const connection = await buildRemoteConnection(
        context,
        workspaceFolder,
        configuration
      );
      await uploadLocalFileToRemote(connection, filePath, remoto);
      setStatus(
        "ready",
        `Último envio: ${configuration.connectionName} — ${shortLocalName}`
      );
    } catch (error) {
      logError("Falha no envio", error);
      setStatus(
        "error",
        `Falha ao enviar "${shortLocalName}"; veja o registo.`
      );
      if (origin === "manual_command") {
        vscode.window.showErrorMessage(
          "Falha ao enviar ficheiro. Veja o registo DogSync."
        );
      }
    }
  };
  if (origin === "save") {
    await scheduleDebouncedUpload(
      filePath,
      buildConnectionPoolKey(workspaceFolder, configuration.connectionName),
      doUpload
    );
    return;
  }
  await doUpload();
}

function coerceFileUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value.scheme === "file" ? value : undefined;
  }
  if (typeof value === "string" && value.length > 0) {
    return vscode.Uri.file(value);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as {
    scheme?: string;
    fsPath?: string;
    path?: string;
  };
  if (record.scheme !== undefined && record.scheme !== "file") {
    return undefined;
  }
  if (typeof record.fsPath === "string" && record.fsPath.length > 0) {
    return vscode.Uri.file(record.fsPath);
  }
  if (typeof record.path === "string" && record.path.length > 0) {
    const raw = record.path;
    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) {
      return vscode.Uri.file(raw);
    }
    return vscode.Uri.file(raw.startsWith("/") ? raw : `/${raw}`);
  }
  return undefined;
}

function resolveExplorerFileUri(
  first?: unknown,
  second?: unknown
): vscode.Uri | undefined {
  const list = resolveExplorerFileUris(first, second);
  return list[0];
}

function resolveExplorerFileUris(
  first?: unknown,
  second?: unknown
): vscode.Uri[] {
  const collected: vscode.Uri[] = [];
  const pushUnique = (uri: vscode.Uri | undefined): void => {
    if (!uri) {
      return;
    }
    if (collected.some((item) => item.fsPath === uri.fsPath)) {
      return;
    }
    collected.push(uri);
  };

  if (Array.isArray(second)) {
    for (const item of second) {
      pushUnique(coerceFileUri(item));
    }
  }
  if (collected.length === 0 && Array.isArray(first)) {
    for (const item of first) {
      pushUnique(coerceFileUri(item));
    }
  }
  if (collected.length === 0) {
    pushUnique(coerceFileUri(first));
  }
  if (collected.length === 0) {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active?.scheme === "file") {
      pushUnique(active);
    }
  }
  return collected;
}

async function runPathUpload(
  context: vscode.ExtensionContext,
  localUri: vscode.Uri
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(localUri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(
      "O caminho tem de pertencer a uma pasta do espaço de trabalho."
    );
    return;
  }
  const configuration = readConfiguration(workspaceFolder);
  if (!configuration.enabled || !isMinimumConfigurationFilled(configuration)) {
    vscode.window.showErrorMessage(
      "Configure a ligação antes de enviar ficheiros."
    );
    return;
  }
  const raizLocal = resolveAbsoluteLocalRoot(workspaceFolder, configuration);
  const caminhoLocal = localUri.fsPath;
  const relative = posixRelativePath(caminhoLocal, raizLocal);
  if (relative === undefined) {
    vscode.window.showErrorMessage(
      "O caminho selecionado está fora da raiz local configurada."
    );
    return;
  }
  if (shouldIgnorePath(relative, configuration.ignorePatterns)) {
    const msg = `Ignorado pelo ignorePatterns: ${relative}`;
    logLine(msg);
    vscode.window.showWarningMessage(msg);
    return;
  }
  const remoto = joinRemote(configuration.remoteRoot, relative);
  setStatus(
    "syncing",
    `A enviar → ${configuration.connectionName}: ${remoto}`
  );
  try {
    const connection = await buildRemoteConnection(
      context,
      workspaceFolder,
      configuration
    );
    await uploadLocalPathToRemoteRecursive(
      connection,
      caminhoLocal,
      remoto,
      raizLocal,
      (relPosix) => shouldIgnorePath(relPosix, configuration.ignorePatterns)
    );
    logLine(
      `Envio (explorador) [${configuration.connectionName}]: ${caminhoLocal} -> ${remoto}`
    );
    setStatus(
      "ready",
      `Último envio: ${configuration.connectionName} — ${path.basename(caminhoLocal)}`
    );
    vscode.window.showInformationMessage(
      `Enviado para "${configuration.connectionName}": ${remoto}`
    );
  } catch (error) {
    logError("Falha no envio (explorador)", error);
    setStatus("error", "Falha no envio; clique para o registo.");
    vscode.window.showErrorMessage(
      "Falha ao enviar. Veja o registo DogSync."
    );
  }
}

async function runDownload(
  context: vscode.ExtensionContext,
  localUri: vscode.Uri
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(localUri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(
      "O caminho tem de pertencer a uma pasta do espaço de trabalho."
    );
    return;
  }
  const configuration = readConfiguration(workspaceFolder);
  if (!configuration.enabled || !isMinimumConfigurationFilled(configuration)) {
    vscode.window.showErrorMessage(
      "Configure a ligação antes de descarregar."
    );
    return;
  }
  const raizLocal = resolveAbsoluteLocalRoot(workspaceFolder, configuration);
  const caminhoLocal = localUri.fsPath;
  const relative = posixRelativePath(caminhoLocal, raizLocal);
  if (relative === undefined) {
    vscode.window.showErrorMessage(
      "O caminho selecionado está fora da raiz local configurada."
    );
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    "Substituir o conteúdo local pela versão do servidor?",
    { modal: true },
    "Sim",
    "Não"
  );
  if (choice !== "Sim") {
    return;
  }
  const remoto = joinRemote(configuration.remoteRoot, relative);
  setStatus("syncing", "A descarregar…");
  try {
    const connection = await buildRemoteConnection(
      context,
      workspaceFolder,
      configuration
    );
    await downloadRemoteToLocal(connection, remoto, caminhoLocal);
    setStatus("ready", "Última descarga concluída.");
    vscode.window.showInformationMessage("Descarga concluída.");
  } catch (error) {
    logError("Falha na descarga", error);
    setStatus("error", "Falha na descarga; clique para o registo.");
    vscode.window.showErrorMessage(
      "Falha ao descarregar. Veja o registo DogSync."
    );
  }
}

/**
 * Sincroniza apagamentos locais para o remoto quando `deleteRemoteAoEliminarLocal` está ativo.
 * Só reage a `onDidDeleteFiles` (gestos do editor); não cobre `rm` no terminal nem outras apps.
 */
async function runRemoteDeleteAfterLocalDelete(
  context: vscode.ExtensionContext,
  event: vscode.FileDeleteEvent,
  treeProvider: SyncTreeProvider
): Promise<void> {
  let anySuccessfulDelete = false;
  for (const uri of event.files) {
    if (uri.scheme !== "file") {
      continue;
    }
    const caminhoLocal = uri.fsPath;
    if (
      caminhoLocal.includes(path.join("sftp-sync-vps-preview") + path.sep)
    ) {
      continue;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      continue;
    }
    const configuration = readConfiguration(workspaceFolder);
    if (
      !configuration.enabled ||
      !isMinimumConfigurationFilled(configuration) ||
      !configuration.deleteRemoteOnLocalDelete
    ) {
      continue;
    }
    const raizLocal = resolveAbsoluteLocalRoot(workspaceFolder, configuration);
    const relative = posixRelativePath(caminhoLocal, raizLocal);
    if (relative === undefined) {
      continue;
    }
    if (shouldIgnorePath(relative, configuration.ignorePatterns)) {
      logLine(
        `Apagar local: ignorado para remoto (padrão): ${relative}`
      );
      continue;
    }
    const rawRemote = joinRemote(configuration.remoteRoot, relative);
    const target = normalizeRemotePosixPath(rawRemote);
    if (target.length === 0) {
      continue;
    }
    if (!isRemotePathDescendantOfRoot(configuration.remoteRoot, target)) {
      logLine(
        `Apagar local: caminho remoto calculado fora da raiz — ignorado: ${target}`
      );
      continue;
    }
    const normalizedRoot = normalizeRemotePosixPath(configuration.remoteRoot);
    if (target === normalizedRoot) {
      logLine(
        "Apagar local: não elimina a raiz remota configurada (bloqueado)."
      );
      continue;
    }
    try {
      const connection = await buildRemoteConnection(
        context,
        workspaceFolder,
        configuration
      );
      await deleteRemotePath(connection, target);
      logLine(
        `Apagado no remoto após apagar local [${configuration.connectionName}]: ${target}`
      );
      anySuccessfulDelete = true;
    } catch (error) {
      logError(
        `Apagar remoto após apagar local (${configuration.connectionName} / ${target})`,
        error
      );
    }
  }
  if (anySuccessfulDelete) {
    treeProvider.refresh();
  }
}

export function deactivate(): void {
  disposeAllConnectionPools();
  void flushUploadQueues();
}
