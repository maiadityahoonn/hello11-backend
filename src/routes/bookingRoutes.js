import express from "express";
import { createBooking, getUserBookings, getScheduledBookings, getScheduledHistory, getBookingById, cancelBooking, getBookingStatus, startRide, completeRide, verifyPayment, acceptReturnOffer, startWaiting, updatePaymentChoice, requestPayment } from "../controllers/bookingController.js";
import { authenticate } from "../middleware/auth.js";

import { cacheData } from "../middleware/cacheMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Booking routes
router.post("/", createBooking);
router.get("/", cacheData(30), getUserBookings);
router.get("/scheduled", cacheData(30), getScheduledBookings);
router.get("/scheduled/history", cacheData(60), getScheduledHistory);
router.get("/:id", cacheData(15), getBookingById);
router.get("/:id/status", getBookingStatus);
router.put("/:id/cancel", cancelBooking);
router.put("/:id/start", startRide);
router.put("/:id/complete", completeRide);
router.put("/:id/verify-payment", verifyPayment);
router.put("/:id/accept-return", acceptReturnOffer);
router.put("/:id/start-waiting", startWaiting);
router.put("/:id/update-payment-choice", updatePaymentChoice);
router.post("/:id/request-payment", requestPayment);

export default router;
