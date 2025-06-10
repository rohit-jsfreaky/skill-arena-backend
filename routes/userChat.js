import express from "express";

import {
  getUnreadMessage,
  getUsersChat,
  getUsersHistory,
} from "../controllers/userChat.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const personalMessageRoutes = express.Router();

personalMessageRoutes.post("/users", authMiddleware, getUsersChat);

personalMessageRoutes.get(
  "/conversations/:receiverId",
  authMiddleware,
  getUsersHistory
);

personalMessageRoutes.get("/unread-counts", authMiddleware, getUnreadMessage);
