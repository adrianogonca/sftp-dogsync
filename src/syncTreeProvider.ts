import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import * as vscode from "vscode";
import {
  downloadRemoteFileForPreview,
  downloadRemoteToLocal,
  deleteRemotePath,
  listRemoteDirectory,
  type RemoteListingEntry,
} from "./remoteClient";
import {
  isRemotePathDescendantOfRoot,
  remotePathRelativeToConfiguredRoot,
  normalizeRemotePosixPath,
} from "./paths";
import { createConnectionWithDefaultsAndOpenEditor } from "./defaultWorkspaceSettings";
import {
  isMinimumConfigurationFilled,
  readConfiguration,
  readConfigurationForConnectionName,
  resolveAbsoluteLocalRoot,
} from "./configuration";
import { setStatus } from "./statusBar";
import {
  deleteFtpPasswordFromVault,
  deleteSshPasswordFromVault,
  readFtpPasswordFromVault,
  readSshPasswordFromVault,
  buildRemoteConnection,
} from "./workspaceRemoteConnection";
import { registerOpenRemoteFile } from "./remoteEditorTracking";
import { logError, logLine } from "./logger";
import {
  openSyncJsonFileInEditor,
  syncJsonAbsolutePath,
  readSyncJsonRootFromDisk,
  listConnectionNames,
  moveConnectionToFirstInSyncRoot,
  removeConnectionFromSyncJsonRootOnDisk,
} from "./syncJsonFile";
import {
  resolveWorkspaceFolder,
  getPrimaryWorkspaceFolder,
} from "./workspaceFolderResolver";
import { markConfigurationIntroCompleted } from "./configurationIntro";

export const TREE_VIEW_ID = "sftpSync.mainPanel";

type ItemKind =
  | "action"
  | "vault-connection"
  | "connection"
  | "default-connection"
  | "section"
  | "vault-section"
  | "empty"
  | "remote-dir"
  | "remote-file";

interface RemoteData {
  connectionName: string;
  remotePath: string;
  isDirectory: boolean;
}

export class SyncTreeProvider
  implements vscode.TreeDataProvider<SyncTreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SyncTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly onAssociatedPanelRefresh?: () => void
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
    this.onAssociatedPanelRefresh?.();
  }

  getTreeItem(element: SyncTreeItem): vscode.TreeItem {
    const collapsible =
      element.collapsible ?? vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(element.label, collapsible);

    item.description = element.description;
    item.tooltip = element.tooltip ?? element.description;
    item.command = element.comando;
    item.contextValue = element.contextValue;
    item.iconPath = element.icon;
    item.id = element.id;

    return item;
  }

  getChildren(element?: SyncTreeItem): Thenable<SyncTreeItem[]> {
    const folder = getPrimaryWorkspaceFolder();

    if (element?.kind === "section" && element.id === "connections") {
      return Promise.resolve(this.obterConexoesComoFilhos(folder));
    }

    if (element?.kind === "vault-section" && element.id === "vault") {
      return this.obterFilhosSecaoCofre(folder);
    }

    if (element?.kind === "vault-connection") {
      return Promise.resolve([]);
    }

    if (element?.remoto) {
      return this.obterFilhosRemotos(folder, element.remoto);
    }

    if (
      (element?.kind === "connection" || element?.kind === "default-connection") &&
      element.id
    ) {
      const cfg = folder
        ? readConfigurationForConnectionName(folder, element.id)
        : null;
      if (cfg && isMinimumConfigurationFilled(cfg)) {
        return this.obterFilhosRemotos(folder, {
          connectionName: element.id,
          remotePath: normalizeRemotePosixPath(cfg.remoteRoot),
          isDirectory: true,
        });
      }
    }

    if (element) {
      return Promise.resolve([]);
    }

    if (!folder) {
      return Promise.resolve([
        new SyncTreeItem("Nova conexão", "action", {
          icon: new vscode.ThemeIcon("add"),
          comando: {
            command: "sftpSync.addConnection",
            title: "DogSync: Adicionar conexão",
          },
          contextValue: "acoes",
          tooltip: "Criar nova entrada em .vscode/sync.jsonc",
        }),
        new SyncTreeItem("Abrir sync.jsonc", "action", {
          icon: new vscode.ThemeIcon("file-code"),
          comando: {
            command: "sftpSync.openSyncJson",
            title: "DogSync: Abrir sync.jsonc",
          },
          contextValue: "acoes",
          tooltip: "Editar configuração no editor",
        }),
        new SyncTreeItem("Cofre de senha", "vault-section", {
          icon: new vscode.ThemeIcon("key"),
          collapsible: vscode.TreeItemCollapsibleState.Collapsed,
          id: "vault",
          contextValue: "vault-section",
          tooltip:
            "Expandir: uma linha por conexão. Clique na conexão para definir senha no cofre (texto visível). *** indica que já existe segredo guardado.",
        }),
        new SyncTreeItem(
          "Abra uma pasta no espaço de trabalho",
          "empty",
          {
            icon: new vscode.ThemeIcon(
              "folder-opened",
              new vscode.ThemeColor("descriptionForeground")
            ),
            tooltip: "File > Open Folder ou adicione uma pasta ao workspace",
          }
        ),
      ]);
    }

    const root = readSyncJsonRootFromDisk(folder);
    const connectionNames = listConnectionNames(root).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    const configuracaoPadrao = readConfiguration(folder);
    const nomePadrao = configuracaoPadrao.connectionName ?? "";

    const itens: SyncTreeItem[] = [
      new SyncTreeItem("Nova conexão", "action", {
        icon: new vscode.ThemeIcon("add"),
        comando: {
          command: "sftpSync.addConnection",
          title: "DogSync: Adicionar conexão",
        },
        contextValue: "acoes",
        tooltip: "Criar nova entrada em .vscode/sync.jsonc",
      }),
      new SyncTreeItem("Abrir sync.jsonc", "action", {
        icon: new vscode.ThemeIcon("file-code"),
        comando: {
          command: "sftpSync.openSyncJson",
          title: "DogSync: Abrir sync.jsonc",
        },
        contextValue: "acoes",
        tooltip: "Editar configuração no editor",
      }),
      new SyncTreeItem("Cofre de senha", "vault-section", {
        icon: new vscode.ThemeIcon("key"),
        collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        id: "vault",
        contextValue: "vault-section",
        tooltip:
          "Expandir: uma linha por conexão. Clique na conexão para definir senha no cofre (texto visível). *** indica que já existe segredo guardado.",
      }),
    ];

    const secaoConexoes = new SyncTreeItem(
      connectionNames.length > 0
        ? `Conexões (${connectionNames.length})`
        : "Conexões",
      "section",
      {
        icon: new vscode.ThemeIcon("server"),
        collapsible: vscode.TreeItemCollapsibleState.Expanded,
        id: "connections",
        tooltip:
          nomePadrao && connectionNames.includes(nomePadrao)
            ? `Padrão: ${nomePadrao}`
            : "Conexões remotas (SFTP/FTP) em sync.jsonc",
      }
    );
    itens.push(secaoConexoes);

    return Promise.resolve(itens);
  }

  /**
   * Filhos da secção «Cofre de senha»: uma linha por conexão; descrição «***» se existir segredo.
   */
  private async obterFilhosSecaoCofre(
    folder: vscode.WorkspaceFolder | undefined
  ): Promise<SyncTreeItem[]> {
    if (!folder) {
      return [
        new SyncTreeItem(
          "(Abra uma pasta no espaço de trabalho)",
          "empty",
          {
            icon: new vscode.ThemeIcon(
              "info",
              new vscode.ThemeColor("descriptionForeground")
            ),
            tooltip:
              "É preciso abrir uma pasta para listar conexões do sync.jsonc.",
          }
        ),
      ];
    }

    const root = readSyncJsonRootFromDisk(folder);
    const names = listConnectionNames(root).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    if (names.length === 0) {
      return [
        new SyncTreeItem(
          "(Nenhuma conexão em sync.jsonc)",
          "empty",
          {
            icon: new vscode.ThemeIcon("info"),
            tooltip: "Use «Nova conexão» ou edite .vscode/sync.jsonc.",
          }
        ),
      ];
    }

    const filhos: SyncTreeItem[] = [];
    for (const name of names) {
      const cfg = readConfigurationForConnectionName(folder, name);
      let temSegredo = false;
      let contextValue = "vault-connection-key";
      let protocolLabel = "SFTP (chave privada)";
      if (cfg?.protocol === "ftp") {
        const v = await readFtpPasswordFromVault(
          this.extensionContext.secrets,
          name
        );
        temSegredo = Boolean(v && v.length > 0);
        contextValue = "vault-connection";
        protocolLabel = "FTP";
      } else if (cfg?.sshPasswordAuthentication) {
        const v = await readSshPasswordFromVault(
          this.extensionContext.secrets,
          name
        );
        temSegredo = Boolean(v && v.length > 0);
        contextValue = "vault-connection";
        protocolLabel = "SFTP (utilizador + senha)";
      }

      filhos.push(
        new SyncTreeItem(name, "vault-connection", {
          id: `vault||${name}`,
          description: temSegredo ? "***" : "",
          tooltip: `${name} — ${protocolLabel}. Clique para abrir o campo de senha (vazio e texto visível). Botão direito: remover do cofre, quando aplicável.`,
          icon: new vscode.ThemeIcon("key"),
          contextValue,
          comando: {
            command: "sftpSync.setVaultPasswordFromTree",
            title: "Definir senha no cofre",
            arguments: [name],
          },
        })
      );
    }
    return filhos;
  }

  private async obterFilhosRemotos(
    folder: vscode.WorkspaceFolder | undefined,
    remoto: RemoteData
  ): Promise<SyncTreeItem[]> {
    if (!folder || !remoto.isDirectory) {
      return [];
    }

    const cfg = readConfigurationForConnectionName(folder, remoto.connectionName);
    if (
      !cfg ||
      !cfg.enabled ||
      !isMinimumConfigurationFilled(cfg) ||
      !isRemotePathDescendantOfRoot(cfg.remoteRoot, remoto.remotePath)
    ) {
      return [];
    }

    try {
      const connection = await buildRemoteConnection(
        this.extensionContext,
        folder,
        cfg
      );
      const entries = await listRemoteDirectory(
        connection,
        remoto.remotePath
      );

      return entries.map((e: RemoteListingEntry) =>
        this.entradaParaElemento(e, remoto.connectionName)
      );
    } catch (error) {
      logError(
        `Listagem remota (${remoto.connectionName} / ${remoto.remotePath})`,
        error
      );
      return [
        new SyncTreeItem(
          error instanceof Error ? error.message : "Erro ao listar",
          "empty",
          {
            icon: new vscode.ThemeIcon(
              "error",
              new vscode.ThemeColor("errorForeground")
            ),
          }
        ),
      ];
    }
  }

  private entradaParaElemento(
    e: RemoteListingEntry,
    connectionName: string
  ): SyncTreeItem {
    const id = `${connectionName}||${e.fullRemotePath}||${e.isDirectory}`;
    const remoto: RemoteData = {
      connectionName,
      remotePath: e.fullRemotePath,
      isDirectory: e.isDirectory,
    };

    if (e.isDirectory) {
      return new SyncTreeItem(e.name, "remote-dir", {
        icon: new vscode.ThemeIcon("folder"),
        collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        id,
        remoto,
        contextValue: "remote-dir",
        tooltip: e.fullRemotePath,
      });
    }

    return new SyncTreeItem(e.name, "remote-file", {
      icon: new vscode.ThemeIcon("file"),
      id,
      remoto,
      contextValue: "remote-file",
      tooltip: e.fullRemotePath,
      comando: {
        command: "sftpSync.openRemoteInEditor",
        title: "Abrir no editor",
        arguments: [connectionName, e.fullRemotePath],
      },
    });
  }

  private obterConexoesComoFilhos(
    folder: vscode.WorkspaceFolder | undefined
  ): SyncTreeItem[] {
    if (!folder) {
      return [];
    }

    const root = readSyncJsonRootFromDisk(folder);
    const connectionNames = listConnectionNames(root).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    const configuracaoPadrao = readConfiguration(folder);
    const nomePadrao = configuracaoPadrao.connectionName ?? "";

    if (connectionNames.length === 0) {
      return [
        new SyncTreeItem("Nenhuma conexão definida", "empty", {
          icon: new vscode.ThemeIcon(
            "info",
            new vscode.ThemeColor("descriptionForeground")
          ),
          description: "clique em Nova conexão acima",
          tooltip: "Adicione uma conexão para começar a sincronizar",
        }),
      ];
    }

    const itens: SyncTreeItem[] = [];

    for (const name of connectionNames) {
      const cfg = readConfigurationForConnectionName(folder, name);
      const ok = cfg && isMinimumConfigurationFilled(cfg);
      const isDefault = name === nomePadrao;

      let description: string;
      let icon: vscode.ThemeIcon;

      if (isDefault && ok) {
        description = "padrão";
        icon = new vscode.ThemeIcon(
          "plug",
          new vscode.ThemeColor("charts.green")
        );
      } else if (isDefault) {
        description = "padrão (incompleto)";
        icon = new vscode.ThemeIcon(
          "plug",
          new vscode.ThemeColor("charts.yellow")
        );
      } else if (ok) {
        description = "configurado";
        icon = new vscode.ThemeIcon("plug");
      } else {
        description = "incompleto";
        icon = new vscode.ThemeIcon(
          "plug",
          new vscode.ThemeColor("charts.red")
        );
      }

      const tooltip = cfg
        ? `${cfg.host || "?"}:${cfg.port} — ${cfg.remoteRoot || "/"}`
        : "Preencha servidor, utilizador e raiz remota em sync.jsonc";

      const collapsible = ok
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

      itens.push(
        new SyncTreeItem(
          name,
          isDefault ? "default-connection" : "connection",
          {
            icon,
            description,
            contextValue: "connection",
            id: name,
            tooltip,
            collapsible,
            comando: {
              command: "sftpSync.setDefaultConnection",
              title: "Colocar em primeiro (padrão)",
              arguments: [name],
            },
          }
        )
      );
    }

    return itens;
  }

  async addConnection(): Promise<void> {
    const folder = getPrimaryWorkspaceFolder();
    if (!folder) {
      void vscode.window.showErrorMessage(
        "Abra uma pasta no espaço de trabalho."
      );
      return;
    }
    const name = await vscode.window.showInputBox({
      title: "Nome da conexão",
      prompt:
        "Chave única na raiz do JSON (ex.: Produção). Será criado um array com parâmetros por defeito.",
      placeHolder: "Ex.: VPS principal",
      ignoreFocusOut: true,
    });
    if (name === undefined) {
      return;
    }
    const nomeLimpo = name.trim();
    if (nomeLimpo.length === 0) {
      void vscode.window.showWarningMessage(
        "Indique um nome para a conexão ou cancele."
      );
      return;
    }
    try {
      await createConnectionWithDefaultsAndOpenEditor(folder, nomeLimpo);
      await markConfigurationIntroCompleted(this.extensionContext);
      void vscode.window.showInformationMessage(
        `Entrada "${nomeLimpo}" definida na raiz de .vscode/sync.jsonc.`
      );
      this.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error
          ? error.message
          : "Falha ao gravar ou abrir .vscode/sync.jsonc."
      );
    }
  }

  async openSyncJsonc(): Promise<void> {
    const folder =
      resolveWorkspaceFolder(vscode.window.activeTextEditor?.document.uri) ??
      getPrimaryWorkspaceFolder();
    if (!folder) {
      void vscode.window.showErrorMessage(
        "Abra uma pasta no espaço de trabalho."
      );
      return;
    }
    logLine(`A abrir sync.jsonc em: ${folder.uri.fsPath}`);
    await openSyncJsonFileInEditor(folder);
  }

  async setDefaultConnection(connectionName: string): Promise<void> {
    const folder =
      resolveWorkspaceFolder(vscode.window.activeTextEditor?.document.uri) ??
      getPrimaryWorkspaceFolder();
    const name = connectionName.trim();
    if (!folder || name.length === 0) {
      return;
    }
    moveConnectionToFirstInSyncRoot(folder, name);
    void vscode.window.showInformationMessage(
      `Conexão "${name}" passou a ser a primeira em .vscode/sync.jsonc (padrão para upload e comandos).`
    );
    this.refresh();
  }

  async openSyncJsoncAtConnection(connectionName: string): Promise<void> {
    const folder =
      resolveWorkspaceFolder(vscode.window.activeTextEditor?.document.uri) ??
      getPrimaryWorkspaceFolder();
    if (!folder) {
      void vscode.window.showErrorMessage(
        "Abra uma pasta no espaço de trabalho."
      );
      return;
    }
    const absolutePath = syncJsonAbsolutePath(folder);
    const uri = vscode.Uri.file(absolutePath);
    try {
      if (!fsSync.existsSync(absolutePath)) {
        await openSyncJsonFileInEditor(folder);
        return;
      }
      let lineNumber = 0;
      try {
        const text = fsSync.readFileSync(absolutePath, "utf8");
        const indice = text.indexOf(`"${connectionName}"`);
        if (indice >= 0) {
          lineNumber = text.slice(0, indice).split(/\r?\n/).length - 1;
        }
      } catch {
        /* revelar linha é opcional */
      }
      await vscode.commands.executeCommand("vscode.open", uri);
      if (lineNumber > 0) {
        await vscode.commands.executeCommand("revealLine", {
          lineNumber,
          at: "center",
        });
      }
      logLine(
        `sync.jsonc aberto em ${absolutePath} (conexão "${connectionName}").`
      );
    } catch (error) {
      logError(`Abrir sync.jsonc (${absolutePath})`, error);
      void vscode.window.showErrorMessage(
        `Não foi possível abrir .vscode/sync.jsonc em ${folder.name}.`
      );
    }
  }

  /**
   * Remove a entrada da conexão em `.vscode/sync.jsonc` e apaga segredos SSH/FTP
   * associados a esse nome no cofre da extensão.
   */
  async removeConnectionFromSyncJsonc(connectionName: string): Promise<void> {
    const folder = getPrimaryWorkspaceFolder();
    const name = connectionName.trim();
    if (!folder || name.length === 0) {
      void vscode.window.showErrorMessage(
        "Abra uma pasta no espaço de trabalho."
      );
      return;
    }

    const confirmar = await vscode.window.showWarningMessage(
      `Remover a conexão "${name}" de .vscode/sync.jsonc?`,
      {
        modal: true,
        detail:
          "A entrada no JSON será apagada. Palavras-passe SSH e FTP guardadas para este nome no cofre da extensão também serão removidas.",
      },
      "Remover"
    );
    if (confirmar !== "Remover") {
      return;
    }

    const removida = removeConnectionFromSyncJsonRootOnDisk(folder, name);
    if (!removida) {
      void vscode.window.showWarningMessage(
        `Não existe entrada "${name}" em .vscode/sync.jsonc.`
      );
      return;
    }

    await deleteSshPasswordFromVault(this.extensionContext.secrets, name);
    await deleteFtpPasswordFromVault(this.extensionContext.secrets, name);

    void vscode.window.showInformationMessage(
      `Conexão "${name}" removida de .vscode/sync.jsonc.`
    );
    this.refresh();
  }

  async openRemoteInEditor(
    connectionName: string,
    caminhoRemotoBruto: string
  ): Promise<void> {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      void vscode.window.showErrorMessage(
        "Abra uma pasta no espaço de trabalho."
      );
      return;
    }

    const nomeConexaoTrim = connectionName.trim();
    if (nomeConexaoTrim.length === 0) {
      void vscode.window.showErrorMessage("Indique a conexão.");
      return;
    }

    const configuration = readConfigurationForConnectionName(
      workspaceFolder,
      nomeConexaoTrim
    );
    if (!configuration || !isMinimumConfigurationFilled(configuration)) {
      void vscode.window.showErrorMessage(
        "Configure a ligação (servidor, utilizador, raiz remota; SFTP: chave ou senha SSH; FTP: protocolo \"ftp\" e senha FTP no cofre)."
      );
      return;
    }

    const target = normalizeRemotePosixPath(caminhoRemotoBruto);
    if (target.length === 0) {
      void vscode.window.showErrorMessage("Caminho remoto inválido.");
      return;
    }
    if (
      !isRemotePathDescendantOfRoot(configuration.remoteRoot, target)
    ) {
      void vscode.window.showErrorMessage(
        "Caminho fora da raiz remota configurada."
      );
      return;
    }

    const tempFolder = path.join(os.tmpdir(), "sftp-sync-vps-preview");
    await fs.mkdir(tempFolder, { recursive: true });
    const digest = createHash("sha256").update(target).digest("hex").slice(0, 16);
    const baseSeguro =
      path.posix.basename(target).replace(/[^a-zA-Z0-9._-]/g, "_") || "ficheiro";
    const caminhoLocal = path.join(tempFolder, `${digest}_${baseSeguro}`);

    try {
      const resultadoPrevisualizacao = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "DogSync: a descarregar do servidor…",
          cancellable: false,
        },
        async () => {
          const connection = await buildRemoteConnection(
            this.extensionContext,
            workspaceFolder,
            configuration
          );
          return downloadRemoteFileForPreview(
            connection,
            target,
            caminhoLocal
          );
        }
      );

      const uri = vscode.Uri.file(caminhoLocal);
      const documento = await vscode.workspace.openTextDocument(uri);

      if (!resultadoPrevisualizacao.truncated) {
        registerOpenRemoteFile(
          documento.uri.fsPath,
          target,
          nomeConexaoTrim
        );
      } else {
        void vscode.window.showWarningMessage(
          `Ficheiro remoto grande (${(
            resultadoPrevisualizacao.remoteSize /
            (1024 * 1024)
          ).toFixed(1)} MiB). Aberta só a cauda para caber no limite do editor; guardar não faz upload completo.`
        );
      }

      await vscode.window.showTextDocument(documento, { preview: true });
    } catch (error) {
      logError(`Abrir remoto no editor (${target})`, error);
      void vscode.window.showErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir o ficheiro remoto."
      );
    }
  }

  async deleteRemote(
    connectionName: string,
    caminhoRemotoBruto: string,
    isDirectory: boolean
  ): Promise<void> {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder || !connectionName.trim()) {
      return;
    }

    const configuration = readConfigurationForConnectionName(
      workspaceFolder,
      connectionName.trim()
    );
    if (!configuration || !isMinimumConfigurationFilled(configuration)) {
      void vscode.window.showErrorMessage(
        "Configure a ligação antes de eliminar no servidor."
      );
      return;
    }
    if (!configuration.enabled) {
      void vscode.window.showErrorMessage(
        "Ative sftpSync.enabled no espaço de trabalho para eliminar no servidor."
      );
      return;
    }

    const target = normalizeRemotePosixPath(caminhoRemotoBruto);
    if (target.length === 0) {
      void vscode.window.showErrorMessage("Caminho remoto inválido.");
      return;
    }
    if (
      !isRemotePathDescendantOfRoot(configuration.remoteRoot, target)
    ) {
      void vscode.window.showErrorMessage(
        "Caminho fora da raiz remota configurada."
      );
      return;
    }

    const normalizedRoot = normalizeRemotePosixPath(configuration.remoteRoot);
    if (target === normalizedRoot) {
      void vscode.window.showErrorMessage(
        "Não é permitido eliminar a própria raiz remota configurada."
      );
      return;
    }

    const typeLabel = isDirectory ? "pasta (e todo o conteúdo)" : "ficheiro";
    const confirmar = await vscode.window.showWarningMessage(
      `Eliminar ${typeLabel} no servidor?`,
      {
        modal: true,
        detail: `Conexão: ${connectionName}\n${target}`,
      },
      "Eliminar"
    );

    if (confirmar !== "Eliminar") {
      return;
    }

    try {
      const connection = await buildRemoteConnection(
        this.extensionContext,
        workspaceFolder,
        configuration
      );
      await deleteRemotePath(connection, target);
      logLine(`Eliminado no remoto [${connectionName}]: ${target}`);
      void vscode.window.showInformationMessage(
        `Removido no servidor: ${target}`
      );
      this.refresh();
    } catch (error) {
      logError(`Eliminar remoto (${connectionName} / ${target})`, error);
      void vscode.window.showErrorMessage(
        error instanceof Error
          ? error.message
          : "Falha ao eliminar no servidor."
      );
    }
  }

  async downloadRemoteToWorkspace(
    connectionName: string,
    caminhoRemotoBruto: string,
    isDirectory: boolean
  ): Promise<void> {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder || !connectionName.trim()) {
      return;
    }

    const configuration = readConfigurationForConnectionName(
      workspaceFolder,
      connectionName.trim()
    );
    if (!configuration || !isMinimumConfigurationFilled(configuration)) {
      void vscode.window.showErrorMessage(
        "Configure a ligação antes de descarregar."
      );
      return;
    }
    if (!configuration.enabled) {
      void vscode.window.showErrorMessage(
        "Ative sftpSync.enabled no espaço de trabalho para descarregar."
      );
      return;
    }

    const target = normalizeRemotePosixPath(caminhoRemotoBruto);
    if (
      !isRemotePathDescendantOfRoot(configuration.remoteRoot, target)
    ) {
      void vscode.window.showErrorMessage(
        "Caminho fora da raiz remota configurada."
      );
      return;
    }

    const posixRelative = remotePathRelativeToConfiguredRoot(
      configuration.remoteRoot,
      target
    );
    if (posixRelative === undefined) {
      void vscode.window.showErrorMessage(
        "Não foi possível mapear o caminho remoto para a pasta local."
      );
      return;
    }

    const raizLocal = resolveAbsoluteLocalRoot(workspaceFolder, configuration);
    const segmentos = posixRelative
      .split("/")
      .filter((s) => s.length > 0);
    const caminhoLocal = path.normalize(
      segmentos.length === 0 ? raizLocal : path.join(raizLocal, ...segmentos)
    );

    const rotuloAlvo = isDirectory ? "esta pasta" : "este ficheiro";
    const choice = await vscode.window.showWarningMessage(
      `Substituir no disco local ${rotuloAlvo} pela versão do servidor?`,
      {
        modal: true,
        detail: `Conexão: ${connectionName}\nRemoto: ${target}\nLocal: ${caminhoLocal}`,
      },
      "Sim",
      "Não"
    );
    if (choice !== "Sim") {
      return;
    }

    setStatus("syncing", "A descarregar…");
    try {
      const connection = await buildRemoteConnection(
        this.extensionContext,
        workspaceFolder,
        configuration
      );
      await downloadRemoteToLocal(connection, target, caminhoLocal);
      setStatus("ready", "Última descarga concluída.");
      void vscode.window.showInformationMessage("Descarga concluída.");
      this.refresh();
    } catch (error) {
      logError(`Descarga painel (${connectionName} / ${target})`, error);
      setStatus("error", "Falha na descarga; clique para o registo.");
      void vscode.window.showErrorMessage(
        error instanceof Error
          ? error.message
          : "Falha ao descarregar. Veja o registo DogSync."
      );
    }
  }
}

class SyncTreeItem {
  constructor(
    public readonly label: string,
    public readonly kind: ItemKind,
    public readonly options: {
      description?: string;
      tooltip?: string;
      collapsible?: vscode.TreeItemCollapsibleState;
      comando?: vscode.Command;
      contextValue?: string;
      icon?: vscode.ThemeIcon;
      id?: string;
      remoto?: RemoteData;
    } = {}
  ) {}

  get description(): string | undefined {
    return this.options.description;
  }

  get tooltip(): string | undefined {
    return this.options.tooltip;
  }

  get collapsible(): vscode.TreeItemCollapsibleState | undefined {
    return this.options.collapsible;
  }

  get comando(): vscode.Command | undefined {
    return this.options.comando;
  }

  get contextValue(): string | undefined {
    return this.options.contextValue;
  }

  get icon(): vscode.ThemeIcon | undefined {
    return this.options.icon;
  }

  get id(): string | undefined {
    return this.options.id;
  }

  get remoto(): RemoteData | undefined {
    return this.options.remoto;
  }
}
