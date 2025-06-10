import express from "express";
import {
  getAllGames,
  getGameById,
  getGamesBasedOnUser,
} from "../controllers/games.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const gamesRouter = express.Router();

// Public endpoints (require authentication)
gamesRouter.get("/", authMiddleware, getAllGames);
gamesRouter.get("/:id", authMiddleware, getGameById);

gamesRouter.post("/get", authMiddleware, getGamesBasedOnUser);

export default gamesRouter;
