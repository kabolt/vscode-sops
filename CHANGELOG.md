# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2025-07-15

### Added
- Localization support.
- French translation.

## [0.1.0] - 2025-07-15

### Added
- **Encrypt File Command**: New command `SOPS: Encrypt File` to encrypt plaintext files based on `.sops.yaml` creation rules.
- The command is available in the Command Palette and the file explorer context menu.
- Support for SOPS `creation_rules` with or without a `path_regex`.
- If multiple creation rules are applicable, the user is prompted to select one.

## [0.0.2] - 2025-07-14

### Added
- Extension icon.

## [0.0.1] - 2025-07-14

### Added
- Initial release.
- Transparently decrypt SOPS files on open.
- Automatically re-encrypt SOPS files on save.
- The extension now activates when a `.sops.yaml` file is found in the workspace.
