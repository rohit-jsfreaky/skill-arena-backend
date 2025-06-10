import express from "express";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";
import { 
  getPageContent, 
  updatePageContent, 
  getAllPages 
} from "../../controllers/admin/pages.js";

export const adminPagesRouter = express.Router();

// Admin routes (require authentication)
adminPagesRouter.get("/", verifyAdmin, getAllPages);
adminPagesRouter.get("/:pageName", verifyAdmin, getPageContent);
adminPagesRouter.put("/:pageName", verifyAdmin, updatePageContent);