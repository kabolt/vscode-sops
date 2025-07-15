import * as vscode from 'vscode';
import { decryptToTempFile, encryptAndReplaceOriginal, isSopsEncrypted, cleanupTempFile, getApplicableCreationRules, encryptFile } from './sopsHandler';

/**
 * Manages the state and logic for handling SOPS-encrypted files.
 */
export class SopsContext {
    private statusBarItem: vscode.StatusBarItem;
    private originalToTempMap = new Map<string, string>();
    private tempToOriginalMap = new Map<string, string>();
    private isCleaningUp = false;
    private cleanupTimeout: NodeJS.Timeout | undefined;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.text = "$(lock) SOPS";
        this.statusBarItem.tooltip = "SOPS encrypted file";
        this.statusBarItem.hide();
    }

    /**
     * Registers all the necessary event listeners for the extension.
     * @param context The extension context.
     */
    public register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            this.statusBarItem,
            vscode.workspace.onDidSaveTextDocument(this.onDidSaveTextDocument.bind(this)),
            vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument.bind(this)),
            vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor.bind(this)),
            vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument.bind(this)),
            vscode.commands.registerCommand('sops.encryptFile', this.onEncryptFile.bind(this))
        );
    }

    private async onEncryptFile(uri?: vscode.Uri) {
        let fileUri = uri;
        if (!fileUri) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                fileUri = activeEditor.document.uri;
            }
        }

        if (!fileUri) {
            vscode.window.showErrorMessage('No file selected or active editor.');
            return;
        }
        const filePath = fileUri.fsPath;

        const isEncrypted = await isSopsEncrypted(await vscode.workspace.fs.readFile(fileUri).then(content => content.toString()));
        if (isEncrypted) {
            vscode.window.showInformationMessage('File is already encrypted with SOPS.');
            return;
        }

        const creationRules = await getApplicableCreationRules(filePath);
        if (creationRules.length === 0) {
            vscode.window.showErrorMessage(`No SOPS creation rule found for ${filePath}.`);
            return;
        }

        let selectedRule: any;
        if (creationRules.length > 1) {
            const items = creationRules.map(rule => ({
                label: Object.keys(rule).filter(k => k !== 'path_regex').map(k => `${k}: ${rule[k]}`).join(', '),
                description: rule.path_regex ? `(path_regex: ${rule.path_regex})` : '(Fallback rule)',
                rule: rule
            }));
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a SOPS creation rule to use for encryption' });
            if (!picked) {
                return; // User cancelled
            }
            selectedRule = picked.rule;
        } else {
            selectedRule = creationRules[0];
        }

        try {
            await encryptFile(filePath, selectedRule);
            vscode.window.showInformationMessage(`Successfully encrypted ${filePath}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to encrypt ${filePath}: ${error.message}`);
        }
    }

    /**
     * Handles the saving of a text document.
     * If a temporary file is saved, the original file is re-encrypted.
     */
    private async onDidSaveTextDocument(document: vscode.TextDocument) {
        const tempPath = document.fileName;
        if (this.tempToOriginalMap.has(tempPath)) {
            const originalPath = this.tempToOriginalMap.get(tempPath)!;
            try {
                await encryptAndReplaceOriginal(document.getText(), originalPath);
                vscode.window.showInformationMessage(`Successfully re-encrypted ${originalPath}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to re-encrypt ${originalPath}: ${error.message}`);
            }
        }
    }

    /**
     * Handles the closing of a text document.
     * Manages the cleanup of maps and cascading editor closures.
     */
    private async onDidCloseTextDocument(document: vscode.TextDocument) {
        const closedPath = document.fileName;
        // If the temporary file is closed, clean everything up.
        if (this.tempToOriginalMap.has(closedPath)) {
            const originalPath = this.tempToOriginalMap.get(closedPath)!;
            cleanupTempFile(closedPath);
            this.tempToOriginalMap.delete(closedPath);
            this.originalToTempMap.delete(originalPath);
        } 
        // If the original file is closed, close the temporary file as well.
        else if (this.originalToTempMap.has(closedPath)) {
            const tempPath = this.originalToTempMap.get(closedPath)!;
            const tempEditor = vscode.window.visibleTextEditors.find(e => e.document.fileName === tempPath);
            if (tempEditor) {
                await this.closeEditor(tempEditor); // This will trigger the case above.
            }
        }
    }

    /**
     * Handles the change of the active text editor.
     * Manages the cleanup of inactive contexts and updates the status bar.
     */
    private onDidChangeActiveTextEditor(editor?: vscode.TextEditor) {
        if (this.cleanupTimeout) {
            clearTimeout(this.cleanupTimeout);
        }

        this.updateStatusBar(editor);

        this.cleanupTimeout = setTimeout(async () => {
            if (this.isCleaningUp) return;
            this.isCleaningUp = true;
            try {
                const currentActiveEditor = vscode.window.activeTextEditor;
                const currentActivePath = currentActiveEditor?.document.fileName;
                const contextsToClean = new Map<string, string>();

                for (const [tempPath, originalPath] of this.tempToOriginalMap.entries()) {
                    if (currentActivePath !== tempPath && currentActivePath !== originalPath) {
                        contextsToClean.set(tempPath, originalPath);
                    }
                }

                for (const [tempPath, originalPath] of contextsToClean.entries()) {
                    const tempEditor = vscode.window.visibleTextEditors.find(e => e.document.fileName === tempPath);
                    if (tempEditor) {
                        await this.closeEditor(tempEditor);
                    } else {
                        cleanupTempFile(tempPath);
                        this.tempToOriginalMap.delete(tempPath);
                        this.originalToTempMap.delete(originalPath);
                    }
                }
            } finally {
                this.isCleaningUp = false;
            }
        }, 200);
    }

    /**
     * Handles the opening of a text document.
     * Decrypts the file if it's a SOPS-encrypted file.
     */
    private async onDidOpenTextDocument(document: vscode.TextDocument) {
        if (this.isCleaningUp) return;
        
        const docPath = document.fileName;

        if (document.uri.scheme !== 'file') {
            return;
        }

        if (this.originalToTempMap.has(docPath) || this.tempToOriginalMap.has(docPath) || document.isClosed) {
            return;
        }

        const isEncrypted = await isSopsEncrypted(document.getText());
        if (isEncrypted) {
            try {
                const newTempPath = await decryptToTempFile(docPath);
                this.tempToOriginalMap.set(newTempPath, docPath);
                this.originalToTempMap.set(docPath, newTempPath);

                const tempDoc = await vscode.workspace.openTextDocument(newTempPath);
                await vscode.window.showTextDocument(tempDoc, { preview: false, viewColumn: vscode.ViewColumn.Active });
            } catch (error: any) {
                vscode.window.showErrorMessage(`SOPS decryption failed: ${error.message}`);
            }
        }
    }

    /**
     * Updates the status bar based on the active editor.
     */
    private updateStatusBar(editor?: vscode.TextEditor) {
        const activePath = editor?.document.fileName;
        if (editor && activePath) {
            if (this.tempToOriginalMap.has(activePath)) {
                this.statusBarItem.text = "$(unlock) SOPS (Decrypted)";
                this.statusBarItem.tooltip = `Decrypted file. Original: ${this.tempToOriginalMap.get(activePath)}`;
                this.statusBarItem.show();
            } else if (this.originalToTempMap.has(activePath)) {
                this.statusBarItem.text = "$(lock) SOPS";
                this.statusBarItem.tooltip = "Encrypted file. Decrypted version is already open.";
                this.statusBarItem.show();
            } else {
                this.statusBarItem.hide();
            }
        } else {
            this.statusBarItem.hide();
        }
    }

    /**
     * Reliably closes a text editor.
     */
    private async closeEditor(editor: vscode.TextEditor) {
        if (vscode.window.visibleTextEditors.some(e => e === editor)) {
            await vscode.window.showTextDocument(editor.document, { preserveFocus: false, preview: false });
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
    }
}