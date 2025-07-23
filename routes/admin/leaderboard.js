import express from "express";
import { verifyAdmin as adminAuthMiddleware } from "../../middlewares/adminAuthMiddleware.js";
import {
  getAllUsersLeaderboardStats,
  getUserLeaderboardStats,
  updateUserLeaderboardStats,
  bulkUpdateLeaderboardStats,
  resetUserLeaderboardStats,
  getLeaderboardRankings,
} from "../../controllers/admin/leaderboard.js";

const adminLeaderboardRouter = express.Router();

// Get all users with their leaderboard stats (with pagination, search, sorting)
adminLeaderboardRouter.get(
  "/users",
  adminAuthMiddleware,
  getAllUsersLeaderboardStats
);

// Get leaderboard rankings
adminLeaderboardRouter.get(
  "/rankings",
  adminAuthMiddleware,
  getLeaderboardRankings
);

// Get specific user's leaderboard stats
adminLeaderboardRouter.get(
  "/users/:userId",
  adminAuthMiddleware,
  getUserLeaderboardStats
);

// Update specific user's leaderboard stats
adminLeaderboardRouter.put(
  "/users/:userId",
  adminAuthMiddleware,
  updateUserLeaderboardStats
);

// Bulk update multiple users' stats
adminLeaderboardRouter.put(
  "/users/bulk",
  adminAuthMiddleware,
  bulkUpdateLeaderboardStats
);

// Reset user's leaderboard stats
adminLeaderboardRouter.patch(
  "/users/:userId/reset",
  adminAuthMiddleware,
  resetUserLeaderboardStats
);

export { adminLeaderboardRouter };
