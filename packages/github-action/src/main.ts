/**
 * The Action's main step: starts Mastyf's free checks on this runner for the rest of the job and
 * hands later steps MASTYF_CHECK_URL and MASTYF_CHECK_TOKEN, which mastyf-ai and @mastyf_ai/guard
 * use first. Nothing is sent anywhere but 127.0.0.1.
 */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enginePath, inContainer as detectContainer, pidAlive, startDetached, stopEngine, verifyHealth } from './engine.js';
import { readInputs, type Inputs } from './inputs.js';
import { exportVariable, fail, info, mask, saveState, setOutput, warning } from './runner.js';

type Env = Record<string, string | undefined>;
type Print = (line: string) => void;

export interface RunOptions {
  print?: Print;
  inContainer?: () => boolean;
}

export async function run(env: Env = process.env, opts: RunOptions = {}): Promise<void> {
  const print = opts.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  let onError: Inputs['onError'] = 'fail';
  const problem = (message: string) => {
    if (onError === 'continue') {
      warning(`Mastyf: ${message}. Continuing without this Action's checks (on-error: continue).`, print);
      saveState('started', 'false', env);
    } else {
      fail(`Mastyf: ${message}`, print);
    }
  };

  let inputs: Inputs;
  try {
    onError = env['INPUT_ON-ERROR']?.trim() === 'continue' ? 'continue' : 'fail';
    inputs = readInputs(env, env['GITHUB_WORKSPACE'] || process.cwd());
    onError = inputs.onError;
  } catch (err) {
    return problem((err as Error).message);
  }

  if ((opts.inContainer ?? detectContainer)()) {
    return problem("container jobs aren't supported yet; run the agent's steps on the runner itself");
  }
  const running = Number(env['MASTYF_ACTION_PID'] ?? 0);
  if (running && pidAlive(running)) {
    return problem('the checks are already running in this job; use this Action once per job');
  }

  const token = randomBytes(32).toString('base64url');
  mask(token, print); // before anything that could print it

  const logFile = join(env['RUNNER_TEMP'] || tmpdir(), `mastyf-check-${randomBytes(6).toString('hex')}.log`);
  const engine = enginePath(env);
  let pid = 0;
  try {
    const startedEngine = await startDetached({
      engine,
      token,
      port: inputs.port,
      maxBodyMb: inputs.maxBodyMb,
      mode: inputs.mode,
      policy: inputs.policy,
      logFile,
    });
    pid = startedEngine.pid;
    await verifyHealth(startedEngine.url, token);

    exportVariable('MASTYF_CHECK_URL', startedEngine.url, env);
    exportVariable('MASTYF_CHECK_TOKEN', token, env);
    exportVariable('MASTYF_ACTION_PID', String(pid), env);
    for (const [k, v] of Object.entries({
      pid: String(pid),
      url: startedEngine.url,
      log: logFile,
      started: 'true',
      showReasons: String(inputs.showReasons),
      failOnBlock: String(inputs.failOnBlock),
    })) {
      saveState(k, v, env);
    }
    setOutput('url', startedEngine.url, env);
    setOutput('engine', engine, env);
    info(`Mastyf checks are on for this job (free tier, on this runner).${inputs.mode === 'observe' ? ' Observe mode: nothing is blocked, what would be is listed.' : ''}`, print);
  } catch (err) {
    if (pid) await stopEngine(pid);
    return problem((err as Error).message);
  }
}

// Run when executed as the Action's entry point (not when imported by tests).
if (process.env['GITHUB_ACTIONS'] === 'true' && /main\.c?js$/.test(process.argv[1] ?? '')) {
  run().catch((err) => fail(`Mastyf: ${(err as Error).message}`));
}
