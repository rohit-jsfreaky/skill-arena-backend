import express from "express";
import {
  createTdmMatch,
  generatePrivateMatchLink,
  getAllTdmMatches,
  getTdmMatchDetails,
  getAllTdmDisputes,
  resolveTdmDispute,
  cancelTdmMatchAdmin,
  getTdmStatistics,
  setTdmMatchWinner
} from "../../controllers/admin/tdmMatch.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";

const adminTdmRouter = express.Router();

// Admin TDM routes (all require admin authentication)
adminTdmRouter.post("/matches/create", verifyAdmin, createTdmMatch);
adminTdmRouter.get("/matches/:match_id/share-link", verifyAdmin, generatePrivateMatchLink);
adminTdmRouter.get("/matches", verifyAdmin, getAllTdmMatches);
adminTdmRouter.get("/matches/:match_id", verifyAdmin, getTdmMatchDetails);
adminTdmRouter.get("/disputes", verifyAdmin, getAllTdmDisputes);
adminTdmRouter.post("/disputes/:dispute_id/resolve", verifyAdmin, resolveTdmDispute);
adminTdmRouter.post("/matches/:match_id/cancel", verifyAdmin, cancelTdmMatchAdmin);
adminTdmRouter.get("/statistics", verifyAdmin, getTdmStatistics);
adminTdmRouter.post("/matches/:match_id/set-winner", verifyAdmin, setTdmMatchWinner);

export default adminTdmRouter;