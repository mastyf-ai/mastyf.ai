import type { ReputationEntry } from './reputation-network.js';
export declare function publishReputationViaMeshRelay(serverName: string, entry: ReputationEntry, packageName?: string): Promise<{
    published: boolean;
    error?: string;
    via: 'mesh' | 'none';
}>;
//# sourceMappingURL=mesh-relay-publish.d.ts.map