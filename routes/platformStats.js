import express from "express";
import {
  getPublicPlatformStats,
  getPublicPlatformStatByKey,
  getBannerStats,
} from "../controllers/platformStats.js";

export const platformStatsRouter = express.Router();

// Get all public platform statistics
platformStatsRouter.get("/", getPublicPlatformStats);

// Get banner statistics (limited for homepage)
platformStatsRouter.get("/banner", getBannerStats);

// Get specific platform statistic by key
platformStatsRouter.get("/key/:key", getPublicPlatformStatByKey);
