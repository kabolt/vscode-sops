# VS Code SOPS

A Visual Studio Code extension for seamlessly encrypting and decrypting files with [Mozilla SOPS](https://github.com/mozilla/sops) on the fly.

This extension allows you to open a SOPS-encrypted file, view its decrypted content in a temporary file, and automatically re-encrypt the content when you save your changes.

## Features

*   **Transparent Decryption**: Automatically decrypts SOPS-encrypted files when you open them.
*   **Automatic Encryption**: Re-encrypts your changes when you save the temporary decrypted file.
*   **Safe by Default**: Works on a temporary copy of your file, and restores a backup if encryption fails for any reason.
*   **Seamless Integration**: Uses your existing `sops` configuration.

## How It Works

1.  When you open a file that is detected as SOPS-encrypted, the extension runs `sops -d` to decrypt it.
2.  The decrypted content is shown in a new temporary file in VS Code. The name of the temporary file can be configured via the `sops_unencrypted_suffix` in your `.sops.yaml` file.
3.  You can edit the temporary file as you normally would.
4.  When you save the temporary file, the extension takes its content and runs `sops --encrypt --in-place` on the original encrypted file.
5.  The temporary file is then deleted.

## Requirements

*   [SOPS](https://github.com/mozilla/sops) must be installed and available in your system's PATH.
*   You need to have your encryption keys (e.g., GPG, AWS KMS, etc.) configured correctly for SOPS to use.

## Usage

1.  Install the extension from the Visual Studio Code Marketplace.
2.  Open a SOPS-encrypted file (e.g., `secrets.yaml`).
3.  A new tab will open with the decrypted content (e.g., `secrets_decrypted.yaml`).
4.  Edit the content in the decrypted file.
5.  Save the decrypted file. The original file will be updated with the new encrypted content.

## Configuration

This extension respects the SOPS configuration file (`.sops.yaml`). You can use it to define which files should be encrypted and how.

A particularly useful setting is `sops_unencrypted_suffix`, which controls the suffix of the temporary decrypted file. For example:

```yaml
creation_rules:
  - path_regex: .*.yaml$
    sops_unencrypted_suffix: _decrypted
```

## License

[MIT](LICENSE)