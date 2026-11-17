# Auto-deploy enhancements to the installed extension

After any enhancement or fix that changes the extension (anything under `src/`, `package.json`, `package.nls*.json`, `l10n/`, or other packaged files), build and install it into Kiro without waiting to be asked.

1. Verify first: `npx tsc --noEmit -p .` must pass.
2. Package:
   `npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license -o /tmp/project-manager-local.vsix`
3. Install:
   `/Applications/Kiro.app/Contents/Resources/app/bin/code --install-extension /tmp/project-manager-local.vsix --force`
4. Tell the user to run **Developer: Reload Window** to load the new build.

Notes:

- Installing is not committing. Commit only when the user asks.
- Do not stage `.vscode/settings.json` (it holds local Peacock color settings).
- Skip the deploy for changes that don't affect the packaged extension (docs, steering files, tests only).
