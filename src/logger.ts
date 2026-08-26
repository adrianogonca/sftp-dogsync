import * as vscode from "vscode";

const channelId = "DogSync";

let channel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(channelId);
  }
  return channel;
}

export function logLine(message: string): void {
  const data = new Date().toISOString();
  getChannel().appendLine(`[${data}] ${message}`);
}

export function logError(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  logLine(`${message}: ${detail}`);
}

export function showChannel(): void {
  getChannel().show(true);
}
