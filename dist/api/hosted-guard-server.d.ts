/**
 * Mastyf AI — Hosted Cloud Guardrail API Server (Method 1: 100% Leak-Proof)
 *
 * Exposes Mastyf Guard 1.5B & the 3-tier perimeter defense engine as a high-performance
 * hosted REST API. Users authenticate via subscription API keys; weights remain 100%
 * protected and proprietary on the server.
 */
import { Request, Response, NextFunction } from 'express';
declare const app: import("express-serve-static-core").Express;
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare const serverInstance: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
export default app;
//# sourceMappingURL=hosted-guard-server.d.ts.map