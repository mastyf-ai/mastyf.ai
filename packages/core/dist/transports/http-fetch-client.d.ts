import { fetch as undiciFetch, type Dispatcher, type RequestInit as UndiciRequestInit } from "undici";
export declare function getDispatcherForOrigin(origin: string): Dispatcher;
export declare function remainingMs(deadline: number): number;
export declare function fetchWithTimeout(url: string, init: UndiciRequestInit, timeoutMs: number, label: string): Promise<Awaited<ReturnType<typeof undiciFetch>>>;
/** @internal */
export declare function resetHttpFetchClientsForTests(): void;
//# sourceMappingURL=http-fetch-client.d.ts.map