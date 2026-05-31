# Threat Model — scenarios/real-life/proxy-filesystem-config.json

Generated: FIXED

## Summary
1 server(s), 0 tool threat row(s), DFD from config.

## Data Flow Diagram

### Nodes
- **client** (client): AI Agent / Client
- **proxy** (proxy): MCP Guardian Proxy
- **server:official-filesystem** (server): official-filesystem

### Edges
- client → proxy: JSON-RPC
- proxy → server:official-filesystem: tools/call

## STRIDE / LINDDUN per Tool
