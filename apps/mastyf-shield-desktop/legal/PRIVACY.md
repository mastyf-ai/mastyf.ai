# Mastyf Shield Privacy Policy (packaged app)

Mastyf Shield is designed to run on your machine. Gateway decisions and receipts stay in the application’s `MASTYF_HOME` under your OS user-data directory.

## What may leave the machine

- **License activation / refresh** — if you configure a license control-plane URL, the app sends the license token, a machine fingerprint (hash of hostname + username + platform), and product version. No receipts or tool arguments are included.
- **Crash reports** — off by default. If you enable them, stack traces from the Electron shell may be sent to the endpoint you configure.
- **GGUF download** — if you choose download-on-first-run, the installer fetches the Guard artifact from the URL on the download page and verifies SHA-256 locally.

## What does not leave the machine by default

Ledger receipts, MCP payloads, dashboard API keys, and control tokens stay local. Packaged builds do not inherit `~/.mastyf` from a previous experiment.

## Contact

privacy@mastyf.ai · support@mastyf.ai
