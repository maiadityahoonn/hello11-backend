import express from "express";
import {
  getDashboardStats,
  getAllUsers,
  getAllDrivers,
  getAllBookings,
  deleteUser,
  deleteDriver,
  updateBookingStatus
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

// Bookings management
router.get("/bookings", getAllBookings);
router.put("/bookings/:id/status", updateBookingStatus);

export default router;
