# Threat Model — Golden Fixture

This fixture validates C2 threat-model markdown structure in CI.

## Summary

Golden reference for STRIDE/LINDDUN threat model output.

## Data Flow Diagram

### Nodes
- **client** (client): AI Agent / Client
- **proxy** (proxy): MCP Guardian Proxy

### Edges
- client → proxy: JSON-RPC

## STRIDE / LINDDUN per Tool

### filesystem / execute_command

**STRIDE**
- ElevationOfPrivilege: Tool may execute arbitrary commands on host

**Mitigations**
- Enforce default-deny policy with explicit tool allowlists
- CC6.7 — MCP Guardian audit trail captures tool-call decisions
