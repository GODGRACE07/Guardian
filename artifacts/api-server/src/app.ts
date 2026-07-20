import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── Global JSON error-handling middleware ──────────────────────────────────────
//
// This 4-argument handler is Express's error middleware signature. It is the
// LAST line of defence: if any async route handler throws an uncaught exception
// and passes it to next(err) — or if Express 5 catches an async rejection
// automatically — this middleware guarantees the client always receives a valid
// JSON error object with a proper HTTP status code.
//
// Without this, Express falls back to its built-in `finalhandler` which sends
// an HTML page (or an empty body on certain edge cases). The frontend's
// `res.json()` call would then throw "Unexpected end of JSON input" or
// "Unexpected token '<'" instead of showing the real error.
//
// NOTE: Must be registered AFTER all routes. Must have exactly 4 parameters
// even if _next is unused — Express identifies error handlers by arity.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(
    { err: { message: msg, stack: err.stack }, method: req.method, url: req.url },
    "[server] ❌ Unhandled route error caught by global handler",
  );

  if (res.headersSent) {
    // Headers already sent — we can't change the response now.
    // Just log; Express will close the connection.
    logger.warn({ url: req.url }, "[server] headers already sent, cannot send error JSON");
    return;
  }

  res.status(500).json({ error: msg ?? "Internal server error" });
});

export default app;
