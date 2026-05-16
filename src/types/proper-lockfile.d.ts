declare module 'proper-lockfile' {
  interface LockOptions {
    retries?: {
      retries: number;
      minTimeout: number;
    };
  }
  export function lockSync(file: string, options?: LockOptions): () => void;
  export function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
}