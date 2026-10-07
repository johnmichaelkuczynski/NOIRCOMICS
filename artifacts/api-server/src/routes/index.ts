import { Router, type IRouter } from "express";
import healthRouter from "./health";
import comicsRouter from "./comics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(comicsRouter);

export default router;
