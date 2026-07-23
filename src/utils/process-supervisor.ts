import { spawn, type ChildProcess } from 'child_process';
import { Logger } from './logger.js';

let supervisorProcess: ChildProcess | null = null;

export function startProcessSupervisor(command: string, args: string[], env: Record<string, string>): void {
  const startChild = () => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: 'inherit',
      detached: false,
    });

    supervisorProcess = child;

    child.on('exit', (code, signal) => {
      Logger.warn(`[supervisor] Proxy exited (code=${code}, signal=${signal}). Restarting in 3s...`);
      setTimeout(startChild, 3000);
    });

    child.on('error', (err) => {
      Logger.error(`[supervisor] Proxy error: ${err.message}. Restarting in 5s...`);
      setTimeout(startChild, 5000);
    });
  };

  startChild();
  Logger.info('[supervisor] Process supervisor started');
}

export function stopProcessSupervisor(): void {
  if (supervisorProcess) {
    supervisorProcess.kill('SIGTERM');
    supervisorProcess = null;
  }
  Logger.info('[supervisor] Process supervisor stopped');
}

export function getSupervisorPid(): number | null {
  return supervisorProcess?.pid ?? null;
}
