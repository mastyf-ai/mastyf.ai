export type LemonLicenseActivateResult = {
  valid: boolean;
  status: 'active' | 'inactive' | 'expired' | 'disabled' | 'rate_limited' | 'network_error' | 'mismatch';
  message: string;
  licenseKeyId?: string;
  instanceId?: string;
  customerEmail?: string;
  customerId?: string;
  productId?: string;
  variantId?: string;
  storeId?: string;
  expiresAt?: string | null;
  activationLimit?: number;
  instancesCount?: number;
};

export type LemonLicenseValidateResult = {
  valid: boolean;
  status: 'active' | 'inactive' | 'expired' | 'disabled' | 'rate_limited' | 'network_error';
  message: string;
  instanceId?: string;
  instancesCount?: number;
};

const LEMON_API_URL = 'https://api.lemonsqueezy.com/v1/licenses';

/**
 * Activates a license key with Lemon Squeezy's official License API,
 * creating a distinct license instance.
 */
export async function activateLemonLicense(opts: {
  licenseKey: string;
  instanceName?: string;
  expectedStoreId?: string;
  expectedProductId?: string;
  expectedVariantId?: string;
  fetchFn?: typeof fetch;
}): Promise<LemonLicenseActivateResult> {
  const customFetch = opts.fetchFn || fetch;
  const instanceName = opts.instanceName || 'gateway-node-default';

  try {
    const res = await customFetch(`${LEMON_API_URL}/activate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        license_key: opts.licenseKey.trim(),
        instance_name: instanceName.trim(),
      }).toString(),
    });

    if (res.status === 429) {
      return {
        valid: false,
        status: 'rate_limited',
        message: 'Lemon Squeezy License API rate limit exceeded (60 req/min). Please try again shortly.',
      };
    }

    let data: any = {};
    try {
      data = await res.json();
    } catch {
      return {
        valid: false,
        status: 'network_error',
        message: `Lemon Squeezy returned non-JSON response (HTTP ${res.status})`,
      };
    }

    if (!data.activated && !data.valid) {
      const errReason = data.error || data.message || 'License key is invalid or inactive';
      const status = errReason.toLowerCase().includes('expired')
        ? 'expired'
        : errReason.toLowerCase().includes('disabled')
        ? 'disabled'
        : 'inactive';

      return {
        valid: false,
        status,
        message: errReason,
      };
    }

    const license = data.license_key || {};
    const instance = data.instance || {};
    const meta = data.meta || {};

    const storeId = meta.store_id !== undefined ? String(meta.store_id) : undefined;
    const productId = meta.product_id !== undefined ? String(meta.product_id) : undefined;
    const variantId = meta.variant_id !== undefined ? String(meta.variant_id) : undefined;
    const customerEmail = meta.customer_email || license.user_email;

    // Strict Product / Store / Variant Guarding
    if (opts.expectedStoreId && storeId && storeId !== opts.expectedStoreId) {
      return {
        valid: false,
        status: 'mismatch',
        message: `License key belongs to unexpected store ID (${storeId})`,
      };
    }

    if (opts.expectedProductId && productId && productId !== opts.expectedProductId) {
      return {
        valid: false,
        status: 'mismatch',
        message: `License key belongs to unexpected product ID (${productId})`,
      };
    }

    if (opts.expectedVariantId && variantId && variantId !== opts.expectedVariantId) {
      return {
        valid: false,
        status: 'mismatch',
        message: `License key belongs to unexpected variant ID (${variantId})`,
      };
    }

    return {
      valid: true,
      status: 'active',
      message: 'License successfully activated on Lemon Squeezy',
      licenseKeyId: license.id !== undefined ? String(license.id) : undefined,
      instanceId: instance.id !== undefined ? String(instance.id) : undefined,
      customerEmail: customerEmail ? String(customerEmail).trim().toLowerCase() : undefined,
      customerId: meta.customer_id !== undefined ? String(meta.customer_id) : undefined,
      productId,
      variantId,
      storeId,
      expiresAt: license.expires_at || null,
      activationLimit: license.activation_limit,
      instancesCount: license.instances_count,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      status: 'network_error',
      message: `Failed to connect to Lemon Squeezy License API: ${msg}`,
    };
  }
}

/**
 * Validates an activated license key and instance with Lemon Squeezy.
 */
export async function validateLemonLicense(opts: {
  licenseKey: string;
  instanceId?: string;
  fetchFn?: typeof fetch;
}): Promise<LemonLicenseValidateResult> {
  const customFetch = opts.fetchFn || fetch;
  const params: Record<string, string> = {
    license_key: opts.licenseKey.trim(),
  };
  if (opts.instanceId) {
    params.instance_id = opts.instanceId.trim();
  }

  try {
    const res = await customFetch(`${LEMON_API_URL}/validate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });

    if (res.status === 429) {
      return {
        valid: false,
        status: 'rate_limited',
        message: 'Lemon Squeezy rate limit exceeded',
      };
    }

    const data: any = await res.json();
    if (!data.valid) {
      const err = data.error || 'License validation failed';
      return {
        valid: false,
        status: err.toLowerCase().includes('expired') ? 'expired' : 'inactive',
        message: err,
      };
    }

    return {
      valid: true,
      status: 'active',
      message: 'License is valid and active',
      instanceId: data.instance?.id ? String(data.instance.id) : opts.instanceId,
      instancesCount: data.license_key?.instances_count,
    };
  } catch (err: unknown) {
    return {
      valid: false,
      status: 'network_error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Deactivates an active license instance on Lemon Squeezy.
 */
export async function deactivateLemonLicense(opts: {
  licenseKey: string;
  instanceId: string;
  fetchFn?: typeof fetch;
}): Promise<{ success: boolean; message: string }> {
  const customFetch = opts.fetchFn || fetch;

  try {
    const res = await customFetch(`${LEMON_API_URL}/deactivate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        license_key: opts.licenseKey.trim(),
        instance_id: opts.instanceId.trim(),
      }).toString(),
    });

    const data: any = await res.json();
    if (data.deactivated) {
      return { success: true, message: 'Instance deactivated successfully' };
    }
    return { success: false, message: data.error || 'Deactivation failed' };
  } catch (err: unknown) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
