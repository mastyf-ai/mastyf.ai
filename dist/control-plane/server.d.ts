import express from 'express';
export interface ControlPlaneServerOptions {
    port?: number;
    policyPath?: string;
}
export declare function createControlPlaneApp(options?: ControlPlaneServerOptions): express.Express;
export declare function startControlPlaneServer(options?: ControlPlaneServerOptions): void;
//# sourceMappingURL=server.d.ts.map