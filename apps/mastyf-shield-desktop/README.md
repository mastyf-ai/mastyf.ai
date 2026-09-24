# Mastyf Shield Desktop

Packaged product shell: process supervisor plus **bundled** Gateway, BFF, static Shield UI, and default policy. Electron never evaluates CBAC/DIFC/Workflow/AIA.

## What a stranger gets

A paying customer who only has the installer must not need this repo, `python3 -m mastyf_gateway`, `scripts/start-dashboard-proxy.sh`, or Next on `:3000`.

`scripts/stage-shield-bundle.sh` copies those pieces into `extraResources`. Packaged `main.cjs` then:

1. Requires a signed `MSH1` license (unless `MASTYF_SHIELD_DEV_LICENSE=1`)
2. Uses `userData` as `MASTYF_HOME` (never `~/.mastyf`)
3. Spawns Gateway on **:18443** and BFF on **:14000**
4. Loads Shield from the BFF origin, not `:3000`
5. Refuses to attach to a leftover laptop stack on `:8443`/`:4000`
6. Unsets `MASTYF_AI_CI_BYPASS_LICENSE` on child processes
7. Tells the truth if Ollama is missing (Guard is not “online”)

## Supported OS (documented minimums)

| OS | Installer | Notes |
|----|-----------|--------|
| macOS 12+ arm64 | DMG | Notarize with Developer ID before website download |
| macOS 12+ Intel | DMG via `pack:mac:intel` | Build on that arch or a matching CI agent |
| Windows 10 21H2+ / 11 (x64, arm64) | NSIS `.exe` | Authenticode (EV if you want SmartScreen to clear) |
| Linux glibc 2.35+ (Ubuntu 22.04+) | AppImage + `.deb` | Publish a signing key + SHA-256 |

## Build

```bash
cd apps/mastyf-shield-desktop
npm install

# Stages stack then packs. Run on the OS you are shipping.
npm run pack:mac          # arm64 DMG
npm run pack:mac:intel
npm run pack:mac:gguf     # also embed ~940MB GGUF
npm run pack:win          # Windows host
npm run pack:linux        # Linux host
npm run checksums
```

Notarization (your Apple account):

```bash
export APPLE_ID=…
export APPLE_APP_SPECIFIC_PASSWORD=…
export APPLE_TEAM_ID=…
export MASTYF_CSC_IDENTITY="Developer ID Application: …"
npm run pack:mac
npm run notarize:mac
```

Unsigned DMGs are not a product. Right-click Open is not a storefront.

## License + storefront

See `distribution/commerce/README.md`. Issue keys with:

```bash
MASTYF_LICENSE_PRIVATE_KEY_FILE=/path/to/pkcs8.pem node scripts/issue-shield-license.mjs buyer@example.com
```

The matching public PEM must be staged as `stack/license-public.pem` (`MASTYF_LICENSE_PUBLIC_KEY_FILE`). Default pack uses the **dev** public key and is not for sale.

## Dev on this laptop (repo checkout)

```bash
cd apps/mastyf-shield-desktop
MASTYF_SHIELD_AUTOSTART=1 npm run dev
```

Unpackaged mode still talks to `:8443`/`:4000` and may load Next on `:3000`. That is dogfood, not the customer path.

## Authority

| Process | Role |
|---------|------|
| Electron | Window, license gate, supervisor |
| Python Gateway | Reference monitor |
| Node BFF | Dashboard API / MCP proxy / static Shield UI |
| Guard V6 | Advisory (Ollama + GGUF/Modelfile) |

Legal copy for the paid binary: `legal/EULA.md`, `PRIVACY.md`, `REFUND.md`.
