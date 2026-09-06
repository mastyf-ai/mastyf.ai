import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { mode: 'date', withTimezone: true }),
  image: text('image'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] })],
);

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  prefix: text('prefix').notNull(),
  name: text('name').notNull().default('default'),
  scopes: text('scopes').notNull().default('["badge:read","policy:read"]'),
  revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { mode: 'date', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const policies = pgTable('policies', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  yamlContent: text('yaml_content').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const proLicenseKeys = pgTable('pro_license_keys', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull().unique(),
  source: text('source').notNull().default('lemonsqueezy'),
  purchaserEmail: text('purchaser_email'),
  lsLicenseKeyId: text('ls_license_key_id').unique(),
  lsOrderId: text('ls_order_id'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const licenseExchangeTokens = pgTable('license_exchange_tokens', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  mastyfAiUrl: text('mastyf-ai_url'),
  expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { mode: 'date', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

// --- Mastyf Guard Commercial Access & Entitlement Projections ---

export const commercialCustomers = pgTable('commercial_customers', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  lemonCustomerId: text('lemon_customer_id').unique(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const commercialSubscriptions = pgTable('commercial_subscriptions', {
  id: text('id').primaryKey(),
  customerId: text('customer_id')
    .notNull()
    .references(() => commercialCustomers.id, { onDelete: 'cascade' }),
  lemonSubscriptionId: text('lemon_subscription_id').notNull().unique(),
  status: text('status').notNull(), // on_trial, active, paused, past_due, unpaid, cancelled, expired
  productId: text('product_id'),
  variantId: text('variant_id'),
  currentPeriodStart: timestamp('current_period_start', { mode: 'date', withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { mode: 'date', withTimezone: true }),
  endsAt: timestamp('ends_at', { mode: 'date', withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { mode: 'date', withTimezone: true }),
  lemonUpdatedAt: timestamp('lemon_updated_at', { mode: 'date', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const commercialEntitlements = pgTable('commercial_entitlements', {
  id: text('id').primaryKey(),
  customerId: text('customer_id')
    .notNull()
    .references(() => commercialCustomers.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id')
    .references(() => commercialSubscriptions.id, { onDelete: 'set null' }),
  product: text('product').notNull().default('mastyf-guard-pro'),
  licenseKeyHash: text('license_key_hash').notNull().unique(),
  licenseKeyPreview: text('license_key_preview'),
  lemonLicenseId: text('lemon_license_id').unique(),
  lemonInstanceId: text('lemon_instance_id'),
  status: text('status').notNull().default('active'), // active, grace_period, expired, disabled
  activationLimit: integer('activation_limit').notNull().default(2),
  instancesCount: integer('instances_count').notNull().default(0),
  lastValidatedAt: timestamp('last_validated_at', { mode: 'date', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const hfEntitlements = pgTable('hf_entitlements', {
  id: text('id').primaryKey(),
  customerId: text('customer_id')
    .notNull()
    .references(() => commercialCustomers.id, { onDelete: 'cascade' }),
  hfUsername: text('hf_username').notNull().unique(),
  repoId: text('repo_id').notNull().default('Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened'),
  status: text('status').notNull().default('pending_request'), // pending_request, granted, revoked, sync_error
  lastSyncedAt: timestamp('last_synced_at', { mode: 'date', withTimezone: true }),
  errorMessage: text('error_message'),
  isPermanentlyBound: boolean('is_permanently_bound').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const webhookEventLogs = pgTable('webhook_event_logs', {
  id: text('id').primaryKey(),
  eventName: text('event_name').notNull(),
  eventTimestamp: timestamp('event_timestamp', { mode: 'date', withTimezone: true }),
  payloadHash: text('payload_hash').notNull(),
  status: text('status').notNull().default('processed'), // processed, ignored, failed
  processedAt: timestamp('processed_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

