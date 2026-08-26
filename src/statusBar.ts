import * as vscode from "vscode";
import { setPanelStatePortrait } from "./panelStatePortrait";
import type { StatusBarState } from "./stateTypes";

let item: vscode.StatusBarItem | undefined;

/** Texto visível na barra (ícone + rótulo DogSync + detalhe truncado). */
const STATUS_BAR_TEXT_MAX_LENGTH = 64;

function truncateForStatusBar(text: string): string {
  const t = text.trim();
  if (t.length <= STATUS_BAR_TEXT_MAX_LENGTH) {
    return t;
  }
  return t.slice(0, STATUS_BAR_TEXT_MAX_LENGTH - 1) + "\u2026";
}

export function initializeStatusBar(
  context: vscode.ExtensionContext
): void {
  item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  item.name = "DogSync";
  item.command = "sftpSync.showLog";
  context.subscriptions.push(item);
  setStatus("inactive");
}

export function setStatus(estado: StatusBarState, detail?: string): void {
  setPanelStatePortrait({
    estado,
    detail: detail ?? "",
  });
  if (!item) {
    return;
  }
  switch (estado) {
    case "ready":
      item.text = "$(cloud-upload) DogSync";
      item.tooltip =
        detail && detail.length > 0
          ? detail + "\n\nClique para abrir o registo DogSync."
          : "Ligado; clique para abrir o registo.";
      item.backgroundColor = undefined;
      break;
    case "syncing": {
      const prefixoSync = "$(sync~spin) DogSync";
      item.text =
        detail && detail.length > 0
          ? prefixoSync + " · " + truncateForStatusBar(detail)
          : prefixoSync;
      item.tooltip = detail ?? "A sincronizar…";
      item.backgroundColor = undefined;
      break;
    }
    case "error":
      item.text = "$(error) DogSync";
      item.tooltip =
        detail ?? "Erro na última operação; clique para o registo.";
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
      break;
    case "inactive":
      item.text = "$(circle-slash) DogSync";
      item.tooltip = "Extensão inativa neste espaço de trabalho.";
      item.backgroundColor = undefined;
      break;
    case "unconfigured":
      item.text = "$(warning) DogSync";
      item.tooltip =
        detail ??
        "Configure servidor, utilizador, raiz remota (SFTP: chave ou senha SSH; FTP: protocolo ftp e senha FTP no cofre).";
      item.backgroundColor = undefined;
      break;
    default:
      break;
  }
  item.show();
}
