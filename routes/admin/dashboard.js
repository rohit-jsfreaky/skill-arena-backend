import express from "express";
import { getDashboardStats } from "../../controllers/admin/dashboard.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";

export const adminDashboardRouter = express.Router();

adminDashboardRouter.get("/stats", verifyAdmin, getDashboardStats);