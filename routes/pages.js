import express from "express";
import { getPageContent } from "../controllers/pages.js";

export const pagesRouter = express.Router();

pagesRouter.get("/:pageName", getPageContent);
