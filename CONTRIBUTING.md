# Contributing to ContentLore

## Local workflow (Windows)

### Preview locally
Use PowerShell and run:

```powershell
./scripts/release-preview.ps1
```

### Deploy manually
Use PowerShell and run:

```powershell
./scripts/release-deploy.ps1
```

## Important guardrails

- Do **not** paste JavaScript directly into `cmd.exe`; edit files in your editor first.
- Keep feature work in a branch and commit before deploy.
- Confirm `GET /styles.css` returns `200` in Wrangler logs before validating UI.
