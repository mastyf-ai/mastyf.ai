/**
 * The Action's main step: starts Mastyf's free checks on this runner for the rest of the job and
 * hands later steps MASTYF_CHECK_URL and MASTYF_CHECK_TOKEN, which mastyf-ai and @mastyf_ai/guard
 * use first. Nothing is sent anywhere but 127.0.0.1.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { enginePath, inContainer as detectContainer, pidAlive, startDetached, stopEngine, verifyHealth } from './engine.js';
import { hooksSwitchedOffIn, readBase, writeClaudeSettings } from './claude-settings.js';
import { readInputs, type Inputs } from './inputs.js';
import { exportVariable, fail, info, mask, saveState, setOutput, warning } from './runner.js';

type Env = Record<string, string | undefined>;
type Print = (line: string) => void;

export interface RunOptions {
  print?: Print;
  inContainer?: () => boolean;
  /** Honour MASTYF_ACTION_CLAUDE_HOOK (default: only under the test runner). */
  allowTestOverrides?: boolean;
}

/** dist/claude-hook.cjs next to the running script. */
function claudeHookPath(env: Env, allowOverride: boolean): string {
  const override = allowOverride ? env['MASTYF_ACTION_CLAUDE_HOOK'] : undefined;
  return override || join(dirname(process.argv[1] ?? '.'), 'claude-hook.cjs');
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
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
  if (inputs.claudeCode) {
    try {
      readBase(inputs.claudeSettingsBase); // a broken base file stops us before anything starts
      const off = hooksSwitchedOffIn(env['GITHUB_WORKSPACE'] || process.cwd());
      if (off) throw new Error(`${off} in this repository switches Claude Code hooks off (disableAllHooks or allowManagedHooksOnly), so Claude Code couldn't be checked; remove that setting`);
    } catch (err) {
      return problem((err as Error).message);
    }
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
      // For the post step only. Later steps can rewrite GITHUB_ENV, but not this Action's state.
      token,
      showReasons: String(inputs.showReasons),
      failOnBlock: String(inputs.failOnBlock),
    })) {
      saveState(k, v, env);
    }
    setOutput('url', startedEngine.url, env);
    setOutput('engine', engine, env);
    if (inputs.claudeCode) {
      const hookPath = claudeHookPath(env, opts.allowTestOverrides ?? process.env['VITEST'] === 'true');
      const written = writeClaudeSettings({
        dir: env['RUNNER_TEMP'] || tmpdir(),
        hookPath,
        url: startedEngine.url,
        token,
        base: inputs.claudeSettingsBase,
      });
      // For the post step: the hooks and the hook program must be unchanged at the end of the job.
      saveState('claudeCommand', written.command, env);
      saveState('claudeHook', hookPath, env);
      saveState('claudeHookSha', existsSync(hookPath) ? sha256(hookPath) : '', env);
      setOutput('claude-settings', written.settings, env);
    }
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
