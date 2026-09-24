# Mastyf Shield changelog

## 0.2.2 — 2026-09-12

Control ledgers (`control_receipts`, operator grants, lockdown, tool pins, active policy) follow `MASTYF_HOME`. Activity on a packaged install no longer reads leftover `~/.mastyf` control history. Dock/DMG/license-gate use the Mastyf mark. Shield UI bundles Outfit + IBM Plex Mono (no Google Fonts fetch). Still unsigned.

## 0.2.1 — 2026-09-12

Unsigned local pack only. Not notarized. Not a website download. The first 211 MB DMG on this machine was incomplete: `npm install` dropped `@mastyf_ai/core`, a stale BFF dist ignored `MASTYF_AI_DEPLOY_DIR` and MSH1, and the BFF defaulted to laptop `:8443`. A later restage must copy workspace packages *after* npm install, ship current BFF dist, set `MASTYF_GATEWAY_URL`, and inject the local dashboard API key in Electron. Packaged builds ignore an inherited `MASTYF_HOME` unless `MASTYF_SHIELD_INHERIT_HOME=1`. userData name is `Mastyf Shield` when packaged.

First customer-shaped pack:

- extraResources now expect a staged **Gateway + BFF + static Shield UI + default policy** (`scripts/stage-shield-bundle.sh`).
- Packaged app loads the UI from the isolated BFF (`:14000`), not `localhost:3000`.
- Isolated ports `:18443` / `:14000`. Refuses to inherit a leftover laptop stack on `:8443`/`:4000`.
- Fresh `userData` ledger. Does not read `~/.mastyf` on first download.
- Packaged children never set `MASTYF_AI_CI_BYPASS_LICENSE`. Offline `MSH1` license gate + BFF verifier.
- Pack targets: macOS DMG (arm64, optional Intel), Windows NSIS, Linux AppImage + deb.
- Notarization / Authenticode / Stripe keys are env-driven and fail closed when missing.

## 0.1.0

Electron supervisor only. Required a repo checkout, system Python, BFF `dist/`, and Next on `:3000`.
