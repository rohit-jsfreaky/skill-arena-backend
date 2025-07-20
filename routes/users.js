import express from "express"
import { createUser, getUserByEmail, handleReferralBonus, updateUser, searchUsers, searchUsersForClient } from "../controllers/user.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const userRoutes = express.Router();

userRoutes.post("/create", authMiddleware, createUser)
userRoutes.post("/get", authMiddleware, getUserByEmail)
userRoutes.post("/update", authMiddleware, updateUser)
userRoutes.post("/apply-referral",authMiddleware,handleReferralBonus)
userRoutes.get("/search", authMiddleware, searchUsers);
userRoutes.get("/search-client", authMiddleware, searchUsersForClient);