import express from "express";
import {
  getDashboardStats,
  getAllUsers,
  getAllDrivers,
  getAllBookings,
  deleteUser,
  deleteDriver,
  verifyDriver,
  updateBookingStatus,
  manualPaymentReset,
  getFinancialReports
} from "../controllers/adminController.js";

const router = express.Router();

// Dashboard
router.get("/stats", getDashboardStats);

// Users management
router.get("/users", getAllUsers);
router.delete("/users/:id", deleteUser);

// Drivers management
router.get("/drivers", getAllDrivers);
router.delete("/drivers/:id", deleteDriver);
router.put("/drivers/:id/verify", verifyDriver);
router.put("/drivers/:id/reset-commission", manualPaymentReset);

// Bookings management
router.get("/bookings", getAllBookings);
router.put("/bookings/:id/status", updateBookingStatus);

// Financials
router.get("/financials", getFinancialReports);

export default router;
