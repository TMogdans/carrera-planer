/**
 * Prozess-Einstieg (`pnpm start` → `node dist-server/server/main.js`, Spec M3b Teil A, REQ-SRV-1
 * und REQ-SRV-5). `NodeRuntime.runMain` fängt SIGINT und SIGTERM selbst ab (auch als PID 1 im
 * Container), schließt dann den Scope (Port, Datenbank) und endet mit Exit-Code 0; scheitert der
 * Start, endet der Prozess mit Exit-Code 1.
 */
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { serve } from "./server.js";

NodeRuntime.runMain(
  Effect.scoped(
    Effect.andThen(
      serve(process.env, { stdout: console.log, stderr: console.error }),
      Effect.never,
    ),
  ),
);
