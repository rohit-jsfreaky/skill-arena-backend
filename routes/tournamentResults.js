import express from "express";

import { authMiddleware } from "../middlewares/authMiddleware.js";
import { verifyAdmin } from "../middlewares/adminAuthMiddleware.js";
import {
  uploadTournamentScreenshot,
  getTournamentScreenshots,
  getParticipantScreenshot,
  verifyTournamentResults,
  getDisputedTournaments,
  adminReviewScreenshot,
} from "../controllers/tournamentResults.js";
import { uploadImage } from "../controllers/admin/imageUpload.js";

const router = express.Router();


// Routes for tournament participants
router.post("/upload-image", authMiddleware, uploadImage);
router.post(
  "/:tournamentId/screenshot",
  authMiddleware,
  uploadTournamentScreenshot
);
router.get(
  "/:tournamentId/screenshot",
  authMiddleware,
  getParticipantScreenshot
);
router.get(
  "/:tournamentId/screenshots",
  authMiddleware,
  getTournamentScreenshots
);

// Admin routes
router.get("/disputed", verifyAdmin, getDisputedTournaments);
router.post("/:tournamentId/admin-review", verifyAdmin, adminReviewScreenshot);

// This route will be automatically called when all participants have uploaded their screenshots
router.get(
  "/:tournamentId/verify-results",
  authMiddleware,
  verifyTournamentResults
);

export default router;
