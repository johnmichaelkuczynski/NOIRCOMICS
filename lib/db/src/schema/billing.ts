import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
