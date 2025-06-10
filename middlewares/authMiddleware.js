import dotenv from "dotenv";
dotenv.config();

import { ClerkExpressWithAuth } from "@clerk/clerk-sdk-node";

export const authMiddleware = ClerkExpressWithAuth({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
});
