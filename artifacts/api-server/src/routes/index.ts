import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import discoveryRouter from "./discovery";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(discoveryRouter);

export default router;
