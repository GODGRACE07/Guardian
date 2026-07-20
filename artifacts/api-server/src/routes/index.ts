import { Router, type IRouter } from "express";
import healthRouter from "./health";
import rulesRouter from "./rules";
import tradeRouter from "./trade";

const router: IRouter = Router();

router.use(healthRouter);
router.use(rulesRouter);
router.use(tradeRouter);

export default router;
