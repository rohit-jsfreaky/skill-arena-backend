import express from "express";
import {
  getAllTournaments,
  getUserTournaments,
  getTournamentHistory,
  getTournamentById,
  createTournament,
  joinTournament,
  getTournamentParticipants,
  getUserTournamentHistory,
  getUserTournamentFinancials,
  getTournamentGroups,
  joinTournamentGroup,
  leaveTournamentGroup,
} from "../controllers/tournaments.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { verifyAdmin } from "../middlewares/adminAuthMiddleware.js";

const tournamentsRouter = express.Router();

tournamentsRouter.get("/", authMiddleware, getAllTournaments);
tournamentsRouter.post("/my-tournaments", authMiddleware, getUserTournaments);
tournamentsRouter.get("/history", authMiddleware, getTournamentHistory);
tournamentsRouter.get(
  "/get/:id",
  authMiddleware,
  verifyAdmin,
  getTournamentById
);
tournamentsRouter.post("/", authMiddleware, createTournament);
tournamentsRouter.post("/:id/join", authMiddleware, joinTournament);
tournamentsRouter.get(
  "/:id/participants",
  authMiddleware,
  verifyAdmin,
  getTournamentParticipants
);
tournamentsRouter.post("/user-history", authMiddleware, getUserTournamentHistory);
tournamentsRouter.post("/user-financials", authMiddleware, getUserTournamentFinancials);

// New slot-based tournament routes
tournamentsRouter.get("/:tournamentId/groups", authMiddleware, getTournamentGroups);
tournamentsRouter.post("/:tournamentId/groups/join", authMiddleware, joinTournamentGroup);
tournamentsRouter.delete("/:tournamentId/groups/leave", authMiddleware, leaveTournamentGroup);

export default tournamentsRouter;






