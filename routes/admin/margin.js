import express from "express"
import { getMargin, updateMargin } from "../../controllers/admin/margin.js"
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js"

const marginRouter = express.Router()

marginRouter.get("/",verifyAdmin,getMargin)

marginRouter.post("/",verifyAdmin,updateMargin)

export default marginRouter