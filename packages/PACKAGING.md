# Packaging Guide

| Package | Purpose |
|---------|---------|
| `@mastyf_ai/server` (root) | **Primary** — CLI, proxy, scanners |
| `@mastyf_ai/core` | Detection engine library |
| `@mastyf_ai/cli` | Thin CLI shim |

Enterprise deployments: use Docker/Helm with `@mastyf_ai/server` image or `npm install -g @mastyf_ai/server`.
