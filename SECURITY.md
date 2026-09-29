# Security Policy

Devian runs with broad access to your machine (processes, ports, Docker, the filesystem), so we take security reports seriously.

## Credentials

Devian never asks for passwords or API keys. Plan limits are off by default. When you turn them on for an account, Devian reads the login that Claude Code (macOS Keychain or `.credentials.json`) or Codex (`~/.codex/auth.json`) already saved, sends it only to that provider's usage endpoint, and keeps it in memory for the request. Tokens are never written to disk, logged, refreshed or shown in the UI.

## Reporting a vulnerability

Please **do not open a public issue.** Instead, use GitHub's [private vulnerability reporting](https://github.com/devian-labs/devian/security/advisories/new) for this repository.

Include steps to reproduce, the affected version and platform, and the impact you observed. We aim to acknowledge reports within 3 business days and will keep you updated until a fix ships.

## Supported versions

Only the latest release receives security fixes. The app updates itself automatically.
