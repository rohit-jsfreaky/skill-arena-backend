import express from 'express';
import { verifyAdmin } from '../../middlewares/adminAuthMiddleware.js';
import { 
  getDisputedTournaments, 
  getTournamentScreenshotsForAdmin,
  adminReviewTournament 
} from '../../controllers/admin/tournamentResults.js';

const router = express.Router();

// Admin routes for tournament result verification
router.get('/disputed-tournaments', verifyAdmin, getDisputedTournaments);
router.get('/:tournamentId/screenshots', verifyAdmin, getTournamentScreenshotsForAdmin);
router.post('/:tournamentId/review', verifyAdmin, adminReviewTournament);

export const adminTournamentResultsRouter = router;