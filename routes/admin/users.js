import express from "express";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";
import { 
  getAllUsers, 
  getUserById, 
  searchUsers,
  deleteUser, 
  banUser,
  unbanUser
} from "../../controllers/admin/users.js";

export const adminUsersRouter = express.Router();

// Add the search endpoint before the :id route
adminUsersRouter.get("/search", verifyAdmin, searchUsers);
adminUsersRouter.get("/", verifyAdmin, getAllUsers);
adminUsersRouter.get("/:id", verifyAdmin, getUserById);
adminUsersRouter.delete("/:id", verifyAdmin, deleteUser);
adminUsersRouter.post("/:id/ban", verifyAdmin, banUser);
adminUsersRouter.post("/:id/unban", verifyAdmin, unbanUser);
