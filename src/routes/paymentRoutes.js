import express from "express";
import { createOrder, verifyPayment } from "../controllers/paymentController.js";
import { authenticateDriver } from "../middleware/driverAuth.js";

const router = express.Router();

router.post("/create-order", authenticateDriver, createOrder);
router.post("/verify-payment", authenticateDriver, verifyPayment);

export default router;
