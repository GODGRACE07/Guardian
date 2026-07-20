import { Router, type IRouter } from "express";
import healthRouter from "./health";
import rulesRouter from "./rules";

const router: IRouter = Router();

router.use(healthRouter);
router.use(rulesRouter);

export default router;
