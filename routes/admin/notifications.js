import express from "express";
import {
  sendGlobalNotification,
  sendUserNotification,
  getNotificationHistory,
} from "../../controllers/admin/notifications.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";
import { sendGlobalNotificationUtil } from "../../utils/sendNotifications.js";

const adminNotificationRouter = express.Router();

// All notification routes require admin authentication
adminNotificationRouter.post("/send/global", sendGlobalNotification);
adminNotificationRouter.post("/send/user", verifyAdmin, sendUserNotification);
adminNotificationRouter.get("/history", verifyAdmin, getNotificationHistory);
adminNotificationRouter.post("/send", async (req, res) => {
  sendGlobalNotificationUtil(
    "hello",
    "hello",
    "https://example.com/image.png",
    { key: "value" }
  );

  res.status(200).json({
    success: true,
    message: "Notification sent successfully",
  });
});

export default adminNotificationRouter;
