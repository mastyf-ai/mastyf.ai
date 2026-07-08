/**
 * Password hashing (Argon2id) and password-policy enforcement.
 *
 * Argon2id is used per OWASP recommendation (resistant to both GPU
 * cracking and side-channel attacks). Parameters follow the OWASP
 * Password Storage Cheat Sheet's Argon2id baseline and can be tuned via
 * env vars for constrained deployments.
 */
import argon2 from 'argon2';
import { randomBytes } from 'crypto';
import type { PasswordPolicy } from './rbac-types.js';

const ARGON2_MEMORY_COST = parseInt(process.env['AUTH_ARGON2_MEMORY_KB'] || '19456', 10); // ~19 MB
const ARGON2_TIME_COST = parseInt(process.env['AUTH_ARGON2_TIME_COST'] || '2', 10);
const ARGON2_PARALLELISM = parseInt(process.env['AUTH_ARGON2_PARALLELISM'] || '1', 10);

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: ARGON2_MEMORY_COST,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // Malformed/foreign hash (e.g. legacy import) — treat as no match
    // rather than throwing, so callers have one failure path.
    return false;
  }
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
  disallowUsernameInPassword: true,
  passwordHistoryCount: 5,
  maxAgeDays: 0, // 0 = disabled
};

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordAgainstPolicy(
  password: string,
  policy: PasswordPolicy,
  context?: { username?: string; email?: string },
): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }
  if (password.length > 256) {
    errors.push('Password must be 256 characters or fewer');
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one symbol');
  }
  if (policy.disallowUsernameInPassword) {
    const lower = password.toLowerCase();
    if (context?.username && context.username.length >= 3 && lower.includes(context.username.toLowerCase())) {
      errors.push('Password must not contain your username');
    }
    if (context?.email) {
      const localPart = context.email.split('@')[0];
      if (localPart && localPart.length >= 3 && lower.includes(localPart.toLowerCase())) {
        errors.push('Password must not contain your email address');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Generate a cryptographically strong random password (used for admin-issued resets). */
export function generateRandomPassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
