import express from "express";
import {
  registerDriver,
  loginDriver,
  getNearbyDrivers,
  getDriverById,
  getDriverProfile,
  updateDriverProfile,
  updateVehicleDetails,
  updateDriverLocation,
  toggleAvailability,
  getAvailableBookings,
  getCurrentBooking,
  acceptBooking,
  rejectBooking,
  updateBookingStatus,
  getDriverHistory,
  getDriverEarnings,
  getDriverReviews,
  verifyRideOtp,
  completeRide,
  cancelBooking,
  getDriverDashboard,
  changePassword,
  logoutDriver,
  toggleOnlineStatus,
  updateDocuments,
  updateTollFee,
  requestPayout,
  updateProfileImage,
  forgotPassword,
  resetPassword
} from "../controllers/driverController.js";
import { getBookingById } from "../controllers/bookingController.js";
import { authenticateDriver } from "../middleware/driverAuth.js";
import { cacheData } from "../middleware/cacheMiddleware.js";

const router = express.Router();

// ================= PUBLIC ROUTES =================

// POST /api/drivers/register - Register a new driver
router.post("/register", registerDriver);

// POST /api/drivers/login - Driver login
router.post("/login", loginDriver);

// GET /api/drivers/nearby - Get nearby available drivers (public)
router.get("/nearby", cacheData(10), getNearbyDrivers);

// POST /api/drivers/forgot-password - Request OTP
router.post("/forgot-password", forgotPassword);

// POST /api/drivers/reset-password - Reset password
router.post("/reset-password", resetPassword);


// ================= PROTECTED ROUTES (Require Authentication) =================

// GET /api/drivers/profile - Get driver profile
router.get("/profile", authenticateDriver, getDriverProfile);

// PUT /api/drivers/profile - Update driver profile
router.put("/profile", authenticateDriver, updateDriverProfile);

// PUT /api/drivers/vehicle - Update vehicle details
router.put("/vehicle", authenticateDriver, updateVehicleDetails);

// PUT /api/drivers/documents - Update driver documents
router.put("/documents", authenticateDriver, updateDocuments);

// PUT /api/drivers/profile-image - Update profile image
router.put("/profile-image", authenticateDriver, updateProfileImage);

// PUT /api/drivers/location - Update driver location
router.put("/location", authenticateDriver, updateDriverLocation);

// PUT /api/drivers/availability - Toggle driver availability
router.put("/availability", authenticateDriver, toggleAvailability);

// PUT /api/drivers/online - Toggle driver online status
router.put("/online", authenticateDriver, toggleOnlineStatus);

// GET /api/drivers/available-bookings - Get available bookings for drivers
router.get("/bookings/available", authenticateDriver, cacheData(10), getAvailableBookings);

// GET /api/drivers/current-booking - Get current assigned booking
router.get("/bookings/current", authenticateDriver, getCurrentBooking);

// GET /api/drivers/history - Get driver booking history
router.get("/bookings/history", authenticateDriver, getDriverHistory);

// GET /api/drivers/bookings/:id/details - Get specific booking details
router.get("/bookings/:id/details", authenticateDriver, getBookingById);

// POST /api/drivers/bookings/:id/accept - Accept a booking
router.post("/bookings/:id/accept", authenticateDriver, acceptBooking);

// POST /api/drivers/bookings/:id/reject - Reject a booking
router.post("/bookings/:id/reject", authenticateDriver, rejectBooking);

// PUT /api/drivers/bookings/:id/status - Update booking status
router.put("/bookings/:id/status", authenticateDriver, updateBookingStatus);

// PUT /api/drivers/bookings/:id/toll - Update toll fee for active booking
router.put("/bookings/:id/toll", authenticateDriver, updateTollFee);

// POST /api/drivers/bookings/:id/cancel - Cancel booking (driver)
router.post("/bookings/:id/cancel", authenticateDriver, cancelBooking);

// POST /api/drivers/bookings/:id/verify-otp - Verify ride OTP
router.post("/bookings/:id/verify-otp", authenticateDriver, verifyRideOtp);

// POST /api/drivers/bookings/:id/complete - Complete ride
router.post("/bookings/:id/complete", authenticateDriver, completeRide);

// GET /api/drivers/earnings - Get driver earnings
router.get("/earnings", authenticateDriver, getDriverEarnings);

// GET /api/drivers/reviews - Get driver reviews
router.get("/reviews", authenticateDriver, getDriverReviews);

// GET /api/drivers/dashboard - Get driver dashboard stats
router.get("/dashboard", authenticateDriver, getDriverDashboard);

// PUT /api/drivers/password - Change password
router.put("/password", authenticateDriver, changePassword);

// POST /api/drivers/logout - Logout driver
router.post("/logout", authenticateDriver, logoutDriver);

// POST /api/drivers/payout - Request payout
router.post("/payout", authenticateDriver, requestPayout);

// GET /api/drivers/:id - Get driver by ID
router.get("/:id", getDriverById);

export default router;
