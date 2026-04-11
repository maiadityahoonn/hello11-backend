import express from "express";
import { createOrder, verifyPayment } from "../controllers/paymentController.js";
import { protectDriver } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/create-order", protectDriver, createOrder);
router.post("/verify-payment", protectDriver, verifyPayment);

export default router;
