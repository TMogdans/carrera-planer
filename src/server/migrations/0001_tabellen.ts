/**
 * Migration 1 (Spec M3b Teil A, REQ-DB-5): je Layout genau eine Zeile, für den Bestand höchstens
 * eine Zeile (`id` ist immer 1). Inhalte stehen als JSON-Text des kodierten Layouts bzw. Bestands;
 * `updated_at` als ISO-8601-Text in UTC (`Date.prototype.toISOString()`).
 */
import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

export default Effect.flatMap(SqlClient.SqlClient, (sql) =>
  Effect.zipRight(
    sql`CREATE TABLE layouts (
      name TEXT PRIMARY KEY NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      updated_at TEXT NOT NULL,
      content TEXT NOT NULL
    ) STRICT`,
    sql`CREATE TABLE bestand (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      version INTEGER NOT NULL CHECK (version >= 1),
      updated_at TEXT NOT NULL,
      content TEXT NOT NULL
    ) STRICT`,
  ),
);
