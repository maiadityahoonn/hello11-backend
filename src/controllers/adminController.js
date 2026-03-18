import User from "../models/User.js";
import Driver from "../models/Driver.js";
import Booking from "../models/Booking.js";

// ================= DASHBOARD STATS =================
export const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalDrivers = await Driver.countDocuments();
    const activeDrivers = await Driver.countDocuments({ available: true });
    const totalBookings = await Booking.countDocuments();
    const ongoingTrips = await Booking.countDocuments({ status: { $in: ["pending", "accepted", "driver_assigned", "arrived", "started"] } });
    const completedTrips = await Booking.countDocuments({ status: "completed" });
    const cancelledTrips = await Booking.countDocuments({ status: "cancelled" });

    // Calculate total earnings
    const earningsResult = await Booking.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$fare" } } }
    ]);
    const totalEarnings = earningsResult.length > 0 ? earningsResult[0].total : 0;

    res.json({
      stats: {
        totalUsers,
        totalDrivers,
        activeDrivers,
        totalBookings,
        ongoingTrips,
        completedTrips,
        cancelledTrips,
        totalEarnings
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch dashboard stats",
      error: error.message
    });
  }
};

// ================= GET ALL USERS =================
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json({ users });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch users",
      error: error.message
    });
  }
};

// ================= GET ALL DRIVERS =================
export const getAllDrivers = async (req, res) => {
  try {
    const drivers = await Driver.find().select("-password").sort({ createdAt: -1 });
    res.json({ drivers });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch drivers",
      error: error.message
    });
  }
};

// ================= GET ALL BOOKINGS =================
export const getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate("user", "name mobile")
      .populate("driver", "name vehicleModel vehicleNumber")
      .sort({ createdAt: -1 });
    res.json({ bookings });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch bookings",
      error: error.message
    });
  }
};

// ================= DELETE USER =================
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete user",
      error: error.message
    });
  }
};

// ================= DELETE DRIVER =================
export const deleteDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndDelete(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    res.json({ message: "Driver deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete driver",
      error: error.message
    });
  }
};

// ================= UPDATE BOOKING STATUS =================
export const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate("user", "name mobile").populate("driver", "name vehicleModel");

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.json({ message: "Booking status updated", booking });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update booking",
      error: error.message
    });
  }
};
