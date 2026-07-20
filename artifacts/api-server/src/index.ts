import app from "./app";
import { logger } from "./lib/logger";
import { startWorker } from "./worker/index.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Process-level safety nets ──────────────────────────────────────────────────
//
// The background worker runs async code outside of any Express request/response
// cycle. If a promise in the worker rejects without being caught, Node emits
// 'unhandledRejection'. Without this handler the process either crashes (Node
// ≥15) or silently swallows the error (older Node). Logging it here gives us
// a visible stack trace in the server console so the cause is always findable.
//
// These handlers do NOT affect HTTP request handling — that safety net is the
// global error middleware in app.ts.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error(
    { reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason },
    "[process] ⚠️  Unhandled promise rejection — check worker or background code",
  );
  // Do NOT exit: the HTTP server should keep serving requests even if the
  // worker has a transient failure. The worker's own retry logic handles recovery.
});

process.on("uncaughtException", (err: Error) => {
  logger.fatal(
    { err: { message: err.message, stack: err.stack } },
    "[process] 💥 Uncaught exception — server may be in an inconsistent state",
  );
  // Exit on truly uncaught synchronous exceptions — the state is unknown.
  process.exit(1);
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start the Guardian background worker after the HTTP server is up.
  // The worker fires its first cycle 10 seconds after boot to avoid
  // hammering OKX during restarts.
  startWorker();
});
