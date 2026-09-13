# Windows installer upgrade acceptance

This prepares a disposable Windows Sandbox run. Preparation copies files only;
it never launches an installer or the app on the host. Windows Sandbox must be
available and enabled before opening the generated `.wsb` file.

```powershell
node scripts/installer-acceptance/prepare.mjs `
  --previous "D:\Installers\WFHelper-1.3.4-Setup.exe" --previous-version 1.3.4 `
  --current "D:\Installers\WFHelper-2.0.0-Setup.exe" --current-version 2.0.0 `
  --output "D:\WFHelper-upgrade-check"
```

The output directory must be new. Open `D:\WFHelper-upgrade-check\WFHelper-upgrade.wsb`
to start the run. Only its dedicated `inputs` directory (read-only) and `results`
directory (writable) are mapped. The repository, home directory and real WFHelper
profile are never shared. Networking and clipboard redirection are disabled.
The copied Node executable supplies the verifier; no dependencies are installed.

Inside Windows Sandbox the runner:

1. Preserves a synthetic `autoInstallHelper: false` preference during silent installation.
2. Installs the previous NSIS installer and checks its installed executable version.
3. Uses that app's renderer IPC to save nondefault scales and import a synthetic
   trade. It also writes a localStorage persistence marker.
4. Closes the previous app, runs the current installer over the same directory,
   then checks the installed version and reads the saved state through the current app.
5. Saves state JSON, screenshots, settings/trade files, logs and `result.json` to `results`.

Check `result.json` for `passed: true`. A missing file means the run did not
complete. Each run needs a fresh Sandbox session. The runner refuses host execution.

Checks NSIS upgrades, startup and saved settings/trades. Updater download/signature
validation and installer UI choices need separate tests. The previous release must
expose `get/setOverlaySettings`, `importTradeLog` and `getTradeLog`; v1.3.4 supports
these APIs. Check API compatibility before testing other releases.

The runner stops on failed shutdowns, unsupported APIs or an unexpected installed version.
