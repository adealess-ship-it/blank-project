import { Router, type IRouter } from "express";
import healthRouter from "./health";
import askRouter from "./ask";
import indicatorContextRouter from "./indicator-context";
import uploadRouter from "./upload";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(askRouter);
router.use(indicatorContextRouter);
router.use(uploadRouter);
router.use(dashboardRouter);

export default router;
