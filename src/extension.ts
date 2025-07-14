import * as vscode from 'vscode';
import { SopsContext } from './SopsContext';

export function activate(context: vscode.ExtensionContext) {
  const sopsContext = new SopsContext();
  sopsContext.register(context);
}

export function deactivate() {}
