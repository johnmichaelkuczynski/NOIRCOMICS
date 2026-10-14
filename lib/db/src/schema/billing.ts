import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const billingUsageTable = pgTable("billing_usage", {
  key: text("key").primaryKey(),
  panels: integer("panels").notNull().default(0),
  scripts: integer("scripts").notNull().default(0),
  voices: integer("voices").notNull().default(0),
  attemptedPanels: integer("attempted_panels").notNull().default(0),
  attemptedScripts: integer("attempted_scripts").notNull().default(0),
  attemptedVoices: integer("attempted_voices").notNull().default(0),
  pendingPanels: integer("pending_panels").notNull().default(0),
  pendingScripts: integer("pending_scripts").notNull().default(0),
  pendingVoices: integer("pending_voices").notNull().default(0),
  reservedUntil: timestamp("reserved_until", { withTimezone: true }),
});

export const playPurchasesTable = pgTable("play_purchases", {
  tokenHash: text("token_hash").primaryKey(),
  encryptedToken: text("encrypted_token").notNull(),
  accountKey: text("account_key").notNull(),
  state: text("state").notNull(),
  active: boolean("active").notNull().default(false),
  orderId: text("order_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  autoRenew: boolean("auto_renew").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
});
export const playDevicesTable = pgTable("play_devices", {
  customerId: text("customer_id").notNull(),
  tokenHash: text("token_hash").notNull(),
}, table => [primaryKey({ columns: [table.customerId, table.tokenHash] })]);
export const playChallengesTable = pgTable("play_challenges", {
  nonceHash: text("nonce_hash").primaryKey(),
  purpose: text("purpose").notNull(),
  customerId: text("customer_id"),
  network: text("network").notNull(),
  consumed: boolean("consumed").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const playEventsTable = pgTable("play_events", {
  messageId: text("message_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull(),
});
