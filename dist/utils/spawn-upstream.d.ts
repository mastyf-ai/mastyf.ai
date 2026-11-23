import { type ChildProcess, type SpawnOptions } from 'node:child_process';
/**
 * Starts an upstream MCP server. On Windows, npx and most other launchers are .cmd shims, which
 * Node's spawn can't run without a shell. cross-spawn finds the shim and escapes each argument for
 * cmd.exe, so a value in an MCP config stays one argument and can't run anything. Other platforms
 * use Node's spawn directly.
 */
export declare function spawnUpstream(command: string, args: string[], options: SpawnOptions): ChildProcess;
//# sourceMappingURL=spawn-upstream.d.ts.map