import { type RugPullEvent } from './rug-pull-store.js';
export declare function triggerRugPullScan(tenantId: string): Promise<{
    serversChecked: number;
    newDetections: number;
    events: RugPullEvent[];
}>;
//# sourceMappingURL=rug-pull-scanner.d.ts.map