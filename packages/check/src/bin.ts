/** The mastyf-check program: runs a command; `serve` and `proxy` keep running until stopped. */
import { run } from './cli';

void (async () => {
  const result = await run(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  });
  if (result.close) {
    const stop = () => void result.close!().then(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return; // keeps running
  }
  process.exitCode = result.code;
})();
