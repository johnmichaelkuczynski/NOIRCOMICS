import { Router, type IRouter } from "express";
import healthRouter from "./health";
import comicsRouter from "./comics";
import comicJobsRouter from "./comic-jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(comicsRouter);
router.use(comicJobsRouter);

export default router;
