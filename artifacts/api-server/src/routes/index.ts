import { Router, type IRouter } from "express";
import healthRouter from "./health";
import comicsRouter from "./comics";
import comicJobsRouter from "./comic-jobs";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(billingRouter);
router.use(comicsRouter);
router.use(comicJobsRouter);

export default router;
