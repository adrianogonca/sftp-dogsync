import * as vscode from "vscode";
import type { StatusBarState } from "./stateTypes";

/**
 * Retrato do estado mostrado na barra e no painel lateral (fonte única).
 */
export interface PanelStatePortrait {
  readonly estado: StatusBarState;
  readonly detail: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly remoteRoot: string;
}

const pattern: PanelStatePortrait = {
  estado: "inactive",
  detail: "",
  host: "",
  port: 22,
  username: "",
  remoteRoot: "",
};

let portrait: PanelStatePortrait = { ...pattern };

export const onPanelStatePortraitChange = new vscode.EventEmitter<void>();

export function getPanelStatePortrait(): PanelStatePortrait {
  return { ...portrait };
}

export function setPanelStatePortrait(
  parcial: Partial<PanelStatePortrait>
): void {
  portrait = { ...portrait, ...parcial };
  onPanelStatePortraitChange.fire();
}

export function resetPanelStatePortrait(): void {
  portrait = { ...pattern };
}
