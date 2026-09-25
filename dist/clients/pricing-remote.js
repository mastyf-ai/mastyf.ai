import { Logger } from '../utils/logger.js';
import { detectZeroPricingAlert, validateSignedPricingEnvelope, } from './pricing-signature.js';
export async function fetchSignedRemotePricing(url) {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(parseInt(process.env['MASTYF_AI_PRICING_FETCH_TIMEOUT_MS'] || '8000', 10)),
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        throw new Error(`pricing fetch failed (${res.status})`);
    }
    const envelope = (await res.json());
    const sig = validateSignedPricingEnvelope(envelope);
    if (!sig.ok) {
        throw new Error(`pricing signature invalid: ${sig.reason}`);
    }
    const zeroModels = detectZeroPricingAlert(envelope.models);
    if (zeroModels.length > 0) {
        Logger.error(`[pricing] Zero-price models rejected from remote feed: ${zeroModels.join(', ')}`);
        throw new Error('remote pricing contains zero-price models — rejected');
    }
    return envelope.models;
}
//# sourceMappingURL=pricing-remote.js.map