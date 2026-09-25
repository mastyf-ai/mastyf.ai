/** Checkout URL removed — mastyf.ai is fully MIT open source. */
export const DEFAULT_PRO_CHECKOUT_URL = '';
export function resolveProCheckoutUrl() {
    const fromEnv = process.env['MASTYF_AI_PRO_CHECKOUT_URL']?.trim()
        || process.env['NEXT_PUBLIC_PRO_CHECKOUT_URL']?.trim();
    return fromEnv || '';
}
/** @deprecated No paid tier — always returns empty string. */
export function getProCheckoutUrl() {
    return resolveProCheckoutUrl();
}
//# sourceMappingURL=pro-checkout-url.js.map