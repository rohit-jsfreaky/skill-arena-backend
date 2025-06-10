import express from "express";
import {
  createDeposit,
  verifyPayment,
  requestWithdrawal,
  getAdminTransactions,
  processWithdrawal,
  getUserTransactions,
} from "../controllers/transactions.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { verifyAdmin } from "../middlewares/adminAuthMiddleware.js";

const paymentRouter = express.Router();

// User routes
paymentRouter.post("/create-deposit", authMiddleware, createDeposit);
paymentRouter.post("/verify-payment", authMiddleware, verifyPayment);
paymentRouter.post("/request-withdrawal", authMiddleware, requestWithdrawal);
paymentRouter.get("/user-transactions", authMiddleware, getUserTransactions);

// Admin routes
paymentRouter.get("/admin/transactions", verifyAdmin, getAdminTransactions);
paymentRouter.post("/admin/process-withdrawal", verifyAdmin, processWithdrawal);

export default paymentRouter;
