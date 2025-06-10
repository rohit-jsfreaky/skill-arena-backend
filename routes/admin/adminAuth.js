import express from "express";
import { loginLimiter } from "../../utils/admin/loginLimiter.js";
import {
  checkAdminAuthStatus,
  generatePasswordResetOTP,
  loginAdmin,
  logoutAdmin,
  refreshAccessToken,
  resetPassword,
  verifyOTP,
} from "../../controllers/admin/auth.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";

export const adminAuthRoutes = express.Router();

adminAuthRoutes.post("/login", loginLimiter, loginAdmin);
adminAuthRoutes.get("/check-auth", checkAdminAuthStatus);
adminAuthRoutes.post("/logout", logoutAdmin);
adminAuthRoutes.post("/refresh-token", refreshAccessToken);
adminAuthRoutes.post("/send-otp", generatePasswordResetOTP);
adminAuthRoutes.post("/verify-otp", verifyOTP);
adminAuthRoutes.post("/reset-password", resetPassword);

adminAuthRoutes.post("/get", verifyAdmin, async (req, res) => {
  const { data } = req.body;
  console.log(data);

  return res.status(200).json({ message: `hey it is succesfull ${data * 2}` });
});


//   /api/admin/auth/logout

// /api/admin/auth/logout