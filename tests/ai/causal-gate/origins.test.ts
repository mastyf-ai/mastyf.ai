import { describe, expect, it } from 'vitest';
import { originOf } from '../../../src/ai/causal-gate/origins.js';

describe('originOf', () => {
  it('marks free-text fields attacker-writable', () => {
    expect(originOf('AmazonGetProductDetails', 'reviews[0].review_content')).toBe('attacker_writable');
    expect(originOf('get_received_emails', 'body')).toBe('attacker_writable');
    expect(originOf('get_received_emails', 'from')).toBe('attacker_writable');
    expect(originOf('GitHubGetUserDetails', 'details.short_bio')).toBe('attacker_writable');
    expect(originOf('anything', 'text')).toBe('attacker_writable');
  });

  it('leaves structured fields unknown', () => {
    expect(originOf('AmazonGetProductDetails', 'product_id')).toBe('unknown');
    expect(originOf('get_contacts', 'contacts[1].email')).toBe('unknown');
  });

  it('treats everything a web or file reader returns as attacker-writable', () => {
    expect(originOf('read_file', 'iban')).toBe('attacker_writable');
    expect(originOf('fetch_url', 'links[0]')).toBe('attacker_writable');
    expect(originOf('get_webpage', 'status')).toBe('attacker_writable');
  });
});
