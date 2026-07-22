import { Router, type IRouter } from "express";
import { getWorkerStatus } from "../worker/index.js";

const router: IRouter = Router();

/**
 * GET /api/status
 * Returns the latest worker cycle stats so the frontend can show a live
 * "Guardian Active" hero with last-check time and rule count.
 */
router.get("/status", (_req, res) => {
  res.json(getWorkerStatus());
});

export default router;
