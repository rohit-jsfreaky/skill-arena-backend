import express from "express";
import { getGlobalLeaderboard, getGameLeaderboard, getUserLeaderboardStats } from "../controllers/leaderboard.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const leaderboardRouter = express.Router();

leaderboardRouter.get("/global", authMiddleware, getGlobalLeaderboard);
leaderboardRouter.get("/game/:gameId", authMiddleware, getGameLeaderboard);
leaderboardRouter.get("/user/:user_id?", authMiddleware, getUserLeaderboardStats);

export default leaderboardRouter;