/**
 * The bits of the GitHub Actions runner protocol this Action uses, without the @actions packages:
 * inputs, masking, env/outputs/state files, the job summary and workflow commands.
 * https://docs.github.com/actions/reference/workflow-commands-for-github-actions
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

type Env = Record<string, string | undefined>;
type Print = (line: string) => void;

const stdout: Print = (line) => process.stdout.write(`${line}\n`);

/** An input as the runner passes it: INPUT_<NAME> with the name upper-cased (hyphens kept). */
export function getInput(name: string, env: Env = process.env): string {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
}

function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Hides `value` in every later log line. Call before the value could be printed anywhere. */
export function mask(value: string, print: Print = stdout): void {
  print(`::add-mask::${escapeData(value)}`);
}

function appendKeyValue(file: string | undefined, kind: string, name: string, value: string): void {
  if (!file) throw new Error(`the runner didn't provide ${kind}`);
  let delimiter = `ghadelimiter_${randomBytes(16).toString('hex')}`;
  while (value.includes(delimiter) || name.includes(delimiter)) delimiter = `ghadelimiter_${randomBytes(16).toString('hex')}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
}

/** Sets an environment variable for every later step of the job. */
export function exportVariable(name: string, value: string, env: Env = process.env): void {
  appendKeyValue(env['GITHUB_ENV'], 'GITHUB_ENV', name, value);
}

export function setOutput(name: string, value: string, env: Env = process.env): void {
  appendKeyValue(env['GITHUB_OUTPUT'], 'GITHUB_OUTPUT', name, value);
}

/** Saves a value for this Action's post step (it reads it back as STATE_<name>). */
export function saveState(name: string, value: string, env: Env = process.env): void {
  appendKeyValue(env['GITHUB_STATE'], 'GITHUB_STATE', name, value);
}

export function getState(name: string, env: Env = process.env): string {
  return env[`STATE_${name}`] ?? '';
}

export function appendSummary(markdown: string, env: Env = process.env): void {
  const file = env['GITHUB_STEP_SUMMARY'];
  if (file) appendFileSync(file, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
}

export function info(message: string, print: Print = stdout): void {
  print(message);
}

export function warning(message: string, print: Print = stdout): void {
  print(`::warning::${escapeData(message)}`);
}

export function error(message: string, print: Print = stdout): void {
  print(`::error::${escapeData(message)}`);
}

/** Marks the step failed (exit code 1) with an error message. */
export function fail(message: string, print: Print = stdout): void {
  error(message, print);
  process.exitCode = 1;
}
