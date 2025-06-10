import express from "express";
import {
  getAllMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
} from "../../controllers/admin/membership.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";

const router = express.Router();

// Apply admin authentication middleware to all routes
router.use(verifyAdmin);

// Membership routes
router.get("/get-all-memberships", getAllMemberships);
router.post("/create-membership", createMembership);
router.put("/update-membership/:id", updateMembership);
router.delete("/delete-membership/:id", deleteMembership);

export const adminMembershipRouter = router;
