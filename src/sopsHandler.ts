import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

/**
 * Decrypts a SOPS-encrypted file to a temporary file.
 * The temporary file is created in the same directory as the original.
 * @param originalPath The path to the encrypted file.
 * @returns The path to the temporary decrypted file.
 */
export async function decryptToTempFile(originalPath: string): Promise<string> {
  const fileDir = dirname(originalPath);
  const decryptedContent = await new Promise<string>((resolve, reject) => {
    exec(`sops -d "${originalPath}"`, { cwd: fileDir }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      resolve(stdout);
    });
  });

  // Extract the `sops_unencrypted_suffix` from the decrypted content to name the temp file.
  let suffix = '_decrypted';
  const match = decryptedContent.match(/sops_unencrypted_suffix\s*=\s*([^\n\r]+)/);
  if (match) {
    suffix = match[1].trim();
  }
  const ext = extname(originalPath);
  const base = basename(originalPath, ext);
  const tempPath = join(
    originalPath.substring(0, originalPath.length - basename(originalPath).length),
    `${base}${suffix}${ext}`
  );

  await fs.writeFile(tempPath, decryptedContent);
  return tempPath;
}

/**
 * Encrypts the given content and replaces the original encrypted file.
 * It creates a backup of the original file before encrypting, and restores it if encryption fails.
 * @param content The plaintext content to encrypt.
 * @param originalPath The path to the original encrypted file.
 */
export async function encryptAndReplaceOriginal(content: string, originalPath: string): Promise<void> {
  const tempBackupPath = originalPath + '.sops-backup.' + randomUUID();

  try {
    // 1. Create a backup of the original encrypted file.
    await fs.copyFile(originalPath, tempBackupPath);

    // 2. Overwrite the original file with the new plaintext content.
    await fs.writeFile(originalPath, content);

    // 3. Encrypt the file in-place, reusing the existing SOPS metadata.
    const fileDir = dirname(originalPath);
    const cmd = `sops --encrypt --in-place "${originalPath}"`;
    
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { cwd: fileDir }, (err, stdout, stderr) => {
        if (err) {
          console.error(`[SOPS ERROR] Re-encryption failed. Stderr: ${stderr}`);
          return reject(new Error(stderr || err.message));
        }
        resolve();
      });
    });

    // 4. If encryption is successful, delete the backup.
    await fs.unlink(tempBackupPath);

  } catch (error) {
    // 5. If any error occurs, restore the backup.
    console.error(`[SOPS ERROR] Encryption failed, restoring backup. Error: ${error}`);
    try {
      await fs.rename(tempBackupPath, originalPath);
    } catch (restoreError) {
      const criticalErrorMsg = `Encryption failed AND backup restoration also failed. The file ${originalPath} might be corrupted or in plaintext. Restore error: ${restoreError}`;
      console.error(`[SOPS CRITICAL] ${criticalErrorMsg}`);
      throw new Error(criticalErrorMsg);
    }
    // Rethrow the original encryption error to notify the caller.
    throw error;
  }
}

/**
 * Finds the applicable SOPS creation rule for a given file path.
 * @param filePath The path to the file.
 * @returns An array of matching creation rules.
 */
export async function getApplicableCreationRules(filePath: string): Promise<any[]> {
  try {
    const configPath = join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', '.sops.yaml');
    const configFile = await fs.readFile(configPath, 'utf8');
    const config = yaml.load(configFile) as any;

    if (!config.creation_rules) {
      return [];
    }

    const applicableRules: any[] = [];
    for (const rule of config.creation_rules) {
      if (!rule.path_regex || new RegExp(rule.path_regex).test(filePath)) {
        applicableRules.push(rule);
      }
    }

    return applicableRules;
  } catch (error) {
    console.error(`[SOPS ERROR] Could not read or parse .sops.yaml: ${error}`);
    return [];
  }
}

/**
 * Encrypts a file using the SOPS CLI with a specific creation rule.
 * @param filePath The path to the file to encrypt.
 * @param rule The creation rule to use for encryption.
 */
export async function encryptFile(filePath: string, rule: any): Promise<void> {
    const fileDir = dirname(filePath);

    let cmd = `sops --encrypt`;
    if (rule.pgp) {
        cmd += ` --pgp ${rule.pgp}`;
    }
    if (rule.age) {
        cmd += ` --age ${rule.age}`;
    }
    // TODO: other key types (kms, gcp_kms, azure_kv)

    cmd += ` --in-place "${filePath}"`;

    await new Promise<void>((resolve, reject) => {
        exec(cmd, { cwd: fileDir }, (err, stdout, stderr) => {
            if (err) {
                console.error(`[SOPS ERROR] Encryption failed. Stderr: ${stderr}`);
                return reject(new Error(stderr || err.message));
            }
            resolve();
        });
    });
}

/**
 * Checks if a file content is likely SOPS-encrypted.
 * This is a heuristic check based on the presence of "sops" and common encryption markers.
 * @param content The content of the file to check.
 * @returns True if the file seems to be SOPS-encrypted.
 */
export async function isSopsEncrypted(content: string): Promise<boolean> {
  const lower = content.toLowerCase();
  if (!lower.includes('sops')) {
    return false;
  }

  // Look for common SOPS encryption markers.
  const hasEncryptedValues = lower.includes('enc[') || /"enc":/.test(lower);
  const hasSopsMetadata = /sops:\n/.test(lower) || /"sops":\s*{/.test(lower);

  return hasEncryptedValues || hasSopsMetadata;
}

/**
 * Safely deletes a temporary file.
 * Ignores errors if the file doesn't exist.
 * @param tempPath The path to the temporary file to delete.
 */
export async function cleanupTempFile(tempPath: string) {
  try {
    await fs.unlink(tempPath);
  } catch (err) {
    // Ignore errors, e.g., if the file has already been deleted.
  }
}
