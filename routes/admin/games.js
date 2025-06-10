import express from "express";
import { 
  getAllGames, 
  getGameById, 
  createGame, 
  updateGame, 
  deleteGame,
  getActiveGames
} from "../../controllers/admin/games.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";

export const adminGamesRouter = express.Router();

// Get all games with pagination and search
adminGamesRouter.get("/get-all-games", verifyAdmin, getAllGames);

// Get a specific game by ID
adminGamesRouter.get("/get-game/:id", verifyAdmin, getGameById);

// Create a new game
adminGamesRouter.post("/create-game", verifyAdmin, createGame);

// Update an existing game
adminGamesRouter.put("/update-game/:id", verifyAdmin, updateGame);

// Delete a game
adminGamesRouter.delete("/delete-game/:id", verifyAdmin, deleteGame);

// Add this new route
adminGamesRouter.get("/active-games", verifyAdmin, getActiveGames);