export type HFGrantStatus =
  | 'granted'
  | 'pending_request'
  | 'invalid_hf_user'
  | 'permission_denied'
  | 'rate_limited'
  | 'sync_error';

export type HFGrantResult = {
  success: boolean;
  status: HFGrantStatus;
  retryable: boolean;
  message: string;
  statusCode?: number;
};

export type HFAccessStatus = {
  hasAccess: boolean;
  status: 'accepted' | 'pending' | 'rejected' | 'none' | 'error';
  message?: string;
};

const DEFAULT_REPO = 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened';

/**
 * Executes a gated model access grant request against Hugging Face Hub API.
 * Classifies exact responses into idempotent success, actionable failure,
 * permission alerts, and retryable errors.
 */
export async function grantHFAccess(opts: {
  hfUsername: string;
  repoId?: string;
  hfToken?: string;
  fetchFn?: typeof fetch;
}): Promise<HFGrantResult> {
  const repoId = opts.repoId || DEFAULT_REPO;
  const hfUsername = opts.hfUsername.trim();
  const token = opts.hfToken || process.env.HF_ACCESS_TOKEN || process.env.HF_TOKEN;
  const customFetch = opts.fetchFn || fetch;

  if (!hfUsername) {
    return {
      success: false,
      status: 'invalid_hf_user',
      retryable: false,
      message: 'Hugging Face username cannot be empty',
    };
  }

  if (!token) {
    return {
      success: false,
      status: 'permission_denied',
      retryable: false,
      message: 'HF_ACCESS_TOKEN is not configured on licensing service',
    };
  }

  const endpoint = `https://huggingface.co/api/models/${encodeURIComponent(repoId)}/user-access-request/handle`;

  try {
    const res = await customFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        user: hfUsername,
        status: 'accepted',
      }),
    });

    const statusCode = res.status;
    let responseBody = '';
    try {
      responseBody = await res.text();
    } catch {
      // ignore text read failure
    }

    // 1. Success
    if (res.ok) {
      return {
        success: true,
        status: 'granted',
        retryable: false,
        statusCode,
        message: `Successfully granted gated model access to @${hfUsername} for ${repoId}`,
      };
    }

    // 2. Idempotent check on 400 Bad Request
    const lowerBody = responseBody.toLowerCase();
    if (
      statusCode === 400 &&
      (lowerBody.includes('already') ||
        lowerBody.includes('accepted') ||
        lowerBody.includes('granted') ||
        lowerBody.includes('access already exists'))
    ) {
      return {
        success: true,
        status: 'granted',
        retryable: false,
        statusCode,
        message: `@${hfUsername} already has access to ${repoId} (idempotent)`,
      };
    }

    // 3. Unknown Hugging Face Username (404)
    if (statusCode === 404) {
      return {
        success: false,
        status: 'invalid_hf_user',
        retryable: false,
        statusCode,
        message: `Hugging Face user '@${hfUsername}' does not exist`,
      };
    }

    // 4. Permission / Admin Token Failure (401 / 403)
    if (statusCode === 401 || statusCode === 403) {
      return {
        success: false,
        status: 'permission_denied',
        retryable: false,
        statusCode,
        message: 'HF_ACCESS_TOKEN lacks permission to manage gated access for this repository',
      };
    }

    // 5. Rate Limited (429)
    if (statusCode === 429) {
      return {
        success: false,
        status: 'rate_limited',
        retryable: true,
        statusCode,
        message: 'Hugging Face API rate limit reached; retry queued',
      };
    }

    // 6. Upstream Server Error (5xx)
    if (statusCode >= 500) {
      return {
        success: false,
        status: 'sync_error',
        retryable: true,
        statusCode,
        message: `Hugging Face API temporary error (HTTP ${statusCode}); retry scheduled`,
      };
    }

    // Fallback unclassified failure
    return {
      success: false,
      status: 'sync_error',
      retryable: true,
      statusCode,
      message: `Hugging Face API returned unclassified status ${statusCode}: ${responseBody}`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: 'sync_error',
      retryable: true,
      message: `Network failure connecting to Hugging Face API: ${errorMsg}`,
    };
  }
}

/**
 * Cancels or revokes gated access for a user.
 */
export async function cancelHFAccess(opts: {
  hfUsername: string;
  repoId?: string;
  hfToken?: string;
  fetchFn?: typeof fetch;
}): Promise<{ success: boolean; message: string; statusCode?: number }> {
  const repoId = opts.repoId || DEFAULT_REPO;
  const hfUsername = opts.hfUsername.trim();
  const token = opts.hfToken || process.env.HF_ACCESS_TOKEN || process.env.HF_TOKEN;
  const customFetch = opts.fetchFn || fetch;

  if (!hfUsername || !token) {
    return { success: false, message: 'Missing username or token' };
  }

  const endpoint = `https://huggingface.co/api/models/${encodeURIComponent(repoId)}/user-access-request/handle`;

  try {
    const res = await customFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: hfUsername,
        status: 'rejected',
      }),
    });

    if (res.ok) {
      return {
        success: true,
        statusCode: res.status,
        message: `Gated access revoked for @${hfUsername}`,
      };
    }

    const text = await res.text();
    return {
      success: false,
      statusCode: res.status,
      message: `Failed to cancel access: ${text}`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
