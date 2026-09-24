/**
 * Packaged Shield must not attach to a leftover laptop stack on :8443/:4000.
 * Isolated defaults: gateway 18443, BFF 14000.
 */
'use strict';

const PACKAGED_GATEWAY = 18443;
const PACKAGED_BFF = 14000;
const DEV_GATEWAY = 8443;
const DEV_BFF = 4000;

/**
 * @param {{
 *   packaged: boolean,
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 */
function resolveAppliancePorts(opts) {
  const env = opts.env || {};
  const packaged = Boolean(opts.packaged);

  const gatewayFromEnv = Number(env.MASTYF_GATEWAY_PORT || 0);
  const bffFromEnv = Number(env.MASTYF_AI_PORT || env.SOC_API_PORT || 0);

  const gatewayPort =
    gatewayFromEnv > 0 ? gatewayFromEnv : packaged ? PACKAGED_GATEWAY : DEV_GATEWAY;
  const bffPort = bffFromEnv > 0 ? bffFromEnv : packaged ? PACKAGED_BFF : DEV_BFF;

  return {
    gatewayPort,
    bffPort,
    isolated: packaged && gatewayPort !== DEV_GATEWAY && bffPort !== DEV_BFF,
    defaults: { packagedGateway: PACKAGED_GATEWAY, packagedBff: PACKAGED_BFF },
  };
}

/**
 * Packaged builds refuse to use the laptop ports when a foreign stack already answers.
 * Isolated ports are always allowed. Explicit MASTYF_SHIELD_ATTACH=1 opts in to attach.
 *
 * @param {{
 *   packaged: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   gatewayPort: number,
 *   bffPort: number,
 *   foreignGatewayOnLaptopPorts?: boolean,
 *   foreignBffOnLaptopPorts?: boolean,
 * }} opts
 */
function evaluateForeignStack(opts) {
  const env = opts.env || {};
  const attach = String(env.MASTYF_SHIELD_ATTACH || '').trim();
  if (attach === '1' || attach.toLowerCase() === 'true') {
    return { ok: true, attach: true, reason: 'explicit-attach' };
  }
  if (!opts.packaged) {
    return { ok: true, attach: false, reason: 'unpackaged-dev' };
  }
  const usingLaptopGateway = opts.gatewayPort === DEV_GATEWAY;
  const usingLaptopBff = opts.bffPort === DEV_BFF;
  if (
    (usingLaptopGateway && opts.foreignGatewayOnLaptopPorts) ||
    (usingLaptopBff && opts.foreignBffOnLaptopPorts)
  ) {
    return {
      ok: false,
      attach: false,
      reason: 'foreign-stack-on-laptop-ports',
      detail:
        'A process already answers on :8443/:4000. Packaged Shield will not inherit that ledger. Unset MASTYF_GATEWAY_PORT/MASTYF_AI_PORT so isolated ports are used, or set MASTYF_SHIELD_ATTACH=1 if you intend to attach.',
    };
  }
  return { ok: true, attach: false, reason: 'isolated-or-free' };
}

module.exports = {
  resolveAppliancePorts,
  evaluateForeignStack,
  PACKAGED_GATEWAY,
  PACKAGED_BFF,
  DEV_GATEWAY,
  DEV_BFF,
};
