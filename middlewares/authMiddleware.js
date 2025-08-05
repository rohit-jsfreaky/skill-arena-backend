import dotenv from "dotenv";
import { getAuth } from "@clerk/express";
import { verifyToken } from "@clerk/backend";
dotenv.config();

export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    console.log("Auth payload:", payload);

    const authPayload = { ...payload, userId: payload.sub };

    // Attach auth to request object for backward compatibility
    req.auth = authPayload;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(401).json({
      error: "Unauthorized: Invalid authentication.",
    });
  }
};
