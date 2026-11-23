export interface KnownAgent {
    id: string;
    name: string;
    configPaths(home: string): string[];
}
export declare const KNOWN_AGENTS: KnownAgent[];
export declare function findAgents(home: string): {
    agent: KnownAgent;
    configPath: string;
}[];
//# sourceMappingURL=agents.d.ts.map