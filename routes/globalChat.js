import express from "express";
import {
  deleteMessage,
  getMessage,
  postMessage,
} from "../controllers/globalChat.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/messages", authMiddleware, getMessage);

router.post("/messages", postMessage);

router.delete("/messages/:id", authMiddleware, deleteMessage);

export { router as chatRoutes };
