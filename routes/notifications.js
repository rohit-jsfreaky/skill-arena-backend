import express from "express";
import { registerFcmToken } from "../controllers/admin/notifications.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { 
  getUserNotifications, 
  markNotificationAsRead, 
  markAllNotificationsAsRead, 
  getUnreadNotificationsCount
} from "../controllers/notifications.js";

const notificationRouter = express.Router();

// Endpoint for clients to register their FCM tokens
notificationRouter.post("/register-token", authMiddleware, registerFcmToken);

// Get user's notifications
notificationRouter.get(
  "/get-user-notifications",
  authMiddleware,
  getUserNotifications
);

// Mark a specific notification as read
notificationRouter.patch(
  "/mark-read/:id",
  authMiddleware,
  markNotificationAsRead
);

// Mark all notifications as read
notificationRouter.patch(
  "/mark-all-read",
  authMiddleware,
  markAllNotificationsAsRead
);

notificationRouter.get(
    "/unread-count",
    authMiddleware,
    getUnreadNotificationsCount
  );

export default notificationRouter;