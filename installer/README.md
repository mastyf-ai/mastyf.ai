# MCP Guardian Windows MSI installer

**Status: planned for v2.7** — not shipped in this release.

A future MSI will bundle:

- Node.js runtime or documented prerequisite check
- `guardian-proxy.ps1` and `dist/` payload
- Start-menu shortcuts for `mcp-guardian doctor` and dashboard
- Per-user `%USERPROFILE%\.mcp-guardian` data directory

WiX source and signing pipeline will live under `installer/` when development starts.
Track progress via the v2.7 roadmap in the root README.

For now, install from npm or clone the repo and use [docs/WINDOWS.md](../docs/WINDOWS.md).
