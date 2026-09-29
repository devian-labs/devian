# Contributing to Devian

Thanks for helping out! This guide covers how to get set up and what we look for in a pull request.

## Getting set up

1. Install Node.js 20+ (`.nvmrc` is provided), a stable Rust toolchain, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.
2. Fork and clone the repo, then run `npm install` at the root.
3. Run `npm run desktop:dev` for the app or `npm run landing:dev` for the website.

No permissions are needed to start; Full Disk Access is optional and only helps the Projects scanner. Run the Rust tests with `cargo test --lib` in `apps/desktop/src-tauri`. You can reset onboarding by clearing the app's local storage from the devtools console: `localStorage.clear()`.

## Where things live

| Path | What |
| --- | --- |
| `apps/desktop/src/screens/` | Top-level screens and tabs (React) |
| `apps/desktop/src/components/` | Shared UI; `ui/` is shadcn/ui |
| `apps/desktop/src-tauri/src/commands/` | Rust commands exposed to the frontend, with per-OS modules (`macos.rs`, `linux.rs`, `windows.rs`) |
| `apps/landing/src/app/` | Website routes; blog posts are MDX under `blog/(posts)/` |
| `Casks/` | Homebrew cask, bumped automatically on release |

## Pull requests

- Open an issue first for anything larger than a bug fix, so we can agree on the approach.
- Keep PRs focused; one change per PR.
- Make sure `npm run build` passes, and `cargo test --lib` in `apps/desktop/src-tauri` if you touched Rust.
- If you add a Rust command, register it in `src-tauri/src/lib.rs` and implement it for every OS module or return a clear error on unsupported platforms.
- Use [Conventional Commit](https://www.conventionalcommits.org/) style messages (`feat:`, `fix:`, `chore:` …).

## Releasing (maintainers)

```bash
npm run release -- 1.3.0
```

This bumps the version everywhere, commits, and pushes a `v1.3.0` tag. The release workflow then builds macOS, Windows and Linux bundles, publishes a GitHub Release with the updater manifest, and updates the Homebrew cask.

### Test builds

To send installers to testers without publishing a release, run the **Test build** workflow from the Actions tab, or push a branch named `test-build/<anything>`. It builds Windows (`.exe`, `.msi`), Linux (`.deb`, `.AppImage`) and macOS (`.dmg`) and attaches them to the run as artifacts for 14 days. Nothing is published, so existing users aren't offered the build.
