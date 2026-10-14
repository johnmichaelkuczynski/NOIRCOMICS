import { Router, type IRouter } from "express";
import healthRouter from "./health";
import comicsRouter from "./comics";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(billingRouter);
router.use(comicsRouter);

export default router;
