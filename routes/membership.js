import express from "express"
import { 
  getMemberShipPlans, 
  getUserMemberShipStatus, 
  createOrder, 
  verifyPayment
} from "../controllers/membership.js"
import { authMiddleware } from "../middlewares/authMiddleware.js"

export const membershipRoutes = express.Router()

membershipRoutes.get("/", authMiddleware, getMemberShipPlans)
membershipRoutes.post("/status", authMiddleware, getUserMemberShipStatus)
membershipRoutes.post("/create-order", authMiddleware, createOrder)
membershipRoutes.post("/verify-payment", authMiddleware, verifyPayment)