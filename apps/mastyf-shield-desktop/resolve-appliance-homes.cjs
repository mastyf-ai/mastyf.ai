/**
 * Isolate packaged Shield ledgers from ~/.mastyf on the same Mac.
 * First download → empty userData home. Explicit env always wins.
 */
'use strict';

const { join } = require('node:path');

/**
 * @param {{
 *   packaged: boolean,
 *   userData?: string,
 *   homedir: string,
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 */
function resolveApplianceHomes(opts) {
  const env = opts.env || {};
  const packaged = Boolean(opts.packaged);
  const userData = String(opts.userData || '').trim();
  const homedir = String(opts.homedir || '').trim();
  const isolated = packaged && Boolean(userData);
  const inherit =
    String(env.MASTYF_SHIELD_INHERIT_HOME || '').trim() === '1' || !packaged;

  const mastyfHome =
    (inherit && String(env.MASTYF_HOME || '').trim()) ||
    (isolated ? join(userData, 'mastyf-home') : join(homedir, '.mastyf'));

  const mastyfAiHome =
    (inherit && String(env.MASTYF_AI_HOME || '').trim()) ||
    (isolated ? join(userData, 'mastyf-ai-home') : join(homedir, '.mastyf-ai'));

  const historyDb =
    String(env.MASTYF_AI_DB_PATH || '').trim() || join(mastyfAiHome, 'history.db');

  const logDir =
    String(env.MASTYF_SHIELD_LOG_DIR || '').trim() ||
    (isolated ? join(userData, 'logs') : join(homedir, '.mastyf', 'shield-desktop-logs'));

  return {
    mastyfHome,
    mastyfAiHome,
    historyDb,
    logDir,
    isolated,
  };
}

/**
 * Packaged builds autostart Gateway/BFF so they actually use the isolated home.
 * MASTYF_SHIELD_AUTOSTART=0 keeps attach-to-existing-stack (that stack's ledger).
 * @param {{ packaged: boolean, env?: NodeJS.ProcessEnv }} opts
 */
function resolveAutostart(opts) {
  const raw = String((opts.env || {}).MASTYF_SHIELD_AUTOSTART || '').trim();
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  return Boolean(opts.packaged);
}

module.exports = { resolveApplianceHomes, resolveAutostart };
