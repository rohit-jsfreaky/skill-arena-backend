import express from "express";
import {
  createTournament,
  deleteTournament,
  getAllTournaments,
  searchTournaments,
  updateTournament,
  createSlotBasedTournament,
} from "../../controllers/admin/tournament.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";
import { uploadImage } from "../../controllers/admin/imageUpload.js";

export const adminTournamentRouter = express.Router();

// Add the search endpoint
adminTournamentRouter.get("/search", verifyAdmin, searchTournaments);
adminTournamentRouter.get(
  "/get-all-tournaments",
  verifyAdmin,
  getAllTournaments
);
adminTournamentRouter.post("/create-tournament", verifyAdmin, createTournament);
adminTournamentRouter.post("/create-slot-tournament", verifyAdmin, createSlotBasedTournament);
adminTournamentRouter.delete(
  "/delete-tournament/:id",
  verifyAdmin,
  deleteTournament
);
adminTournamentRouter.put(
  "/update-tournament/:id",
  verifyAdmin,
  updateTournament
);

adminTournamentRouter.post("/upload-image", verifyAdmin, uploadImage);
