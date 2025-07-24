import express from "express";
import {
  getAllPlatformStats,
  getPlatformStat,
  createPlatformStat,
  updatePlatformStat,
  deletePlatformStat,
  bulkUpdatePlatformStats,
  autoUpdatePlatformStats,
} from "../../controllers/admin/platformStats.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";

export const adminPlatformStatsRouter = express.Router();

// Get all platform statistics
adminPlatformStatsRouter.get("/", verifyAdmin, getAllPlatformStats);

// Get specific platform statistic
adminPlatformStatsRouter.get("/:id", verifyAdmin, getPlatformStat);

// Create new platform statistic
adminPlatformStatsRouter.post("/", verifyAdmin, createPlatformStat);

// Update platform statistic
adminPlatformStatsRouter.put("/:id", verifyAdmin, updatePlatformStat);

// Delete platform statistic
adminPlatformStatsRouter.delete("/:id", verifyAdmin, deletePlatformStat);

// Bulk update platform statistics
adminPlatformStatsRouter.put("/bulk/update", verifyAdmin, bulkUpdatePlatformStats);

// Auto-update platform statistics based on actual data
adminPlatformStatsRouter.post("/auto-update", verifyAdmin, autoUpdatePlatformStats);
