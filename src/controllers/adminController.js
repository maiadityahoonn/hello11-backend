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
    const ongoingTrips = await Booking.countDocuments({ status: { $in: ["pending", "accepted", "driver_assigned", "arrived", "started", "waiting", "return_ride_started"] } });
    const completedTrips = await Booking.countDocuments({ status: "completed" });
    const cancelledTrips = await Booking.countDocuments({ status: "cancelled" });

    // Calculate total earnings (Gross)
    const earningsResult = await Booking.aggregate([
      { $match: { status: "completed" } },
      {
        $project: {
          effectiveTotal: {
            $add: [
              { $ifNull: ["$fare", 0] },
              { $ifNull: ["$returnTripFare", 0] },
              { $ifNull: ["$penaltyApplied", 0] },
              { $ifNull: ["$tollFee", 0] }
            ]
          }
        }
      },
      { $group: { _id: null, total: { $sum: "$effectiveTotal" } } }
    ]);
    const totalEarnings = earningsResult.length > 0 ? earningsResult[0].total : 0;

    // Commission stats
    const commissionResult = await Booking.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$adminCommission", 0] } } } }
    ]);
    const totalAdminCommission = commissionResult.length > 0 ? commissionResult[0].total : 0;

    const pendingResult = await Driver.aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ["$pendingCommission", 0] } } } }
    ]);
    const totalPendingCommission = pendingResult.length > 0 ? pendingResult[0].total : 0;

    res.json({
      stats: {
        totalUsers,
        totalDrivers,
        activeDrivers,
        totalBookings,
        ongoingTrips,
        completedTrips,
        cancelledTrips,
        totalEarnings,
        totalAdminCommission,
        totalPendingCommission
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
    const users = await User.find().select("-password").sort({ createdAt: -1 }).lean();

    const userStats = await Booking.aggregate([
      { $match: { user: { $ne: null }, status: { $ne: "cancelled" } } },
      {
        $project: {
          user: 1,
          effectiveTotal: {
            $add: [
              { $ifNull: ["$fare", 0] },
              { $ifNull: ["$returnTripFare", 0] },
              { $ifNull: ["$penaltyApplied", 0] },
              { $ifNull: ["$tollFee", 0] }
            ]
          },
          totalFare: {
            $ifNull: ["$totalFare", 0]
          }
        }
      },
      {
        $group: {
          _id: "$user",
          totalRides: { $sum: 1 },
          totalSpent: {
            $sum: {
              $cond: [
                { $gt: ["$totalFare", 0] },
                "$totalFare",
                "$effectiveTotal"
              ]
            }
          }
        }
      }
    ]);

    const statsMap = new Map(userStats.map((s) => [String(s._id), s]));
    const enrichedUsers = users.map((u) => {
      const stat = statsMap.get(String(u._id));
      return {
        ...u,
        totalRides: stat?.totalRides || 0,
        totalSpent: stat?.totalSpent || 0
      };
    });

    res.json({ users: enrichedUsers });
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
    const drivers = await Driver.find().select("-password").sort({ createdAt: -1 }).lean();

    const driverStats = await Booking.aggregate([
      { $match: { driver: { $ne: null }, status: "completed" } },
      {
        $project: {
          driver: 1,
          effectiveTotal: {
            $add: [
              { $ifNull: ["$fare", 0] },
              { $ifNull: ["$returnTripFare", 0] },
              { $ifNull: ["$penaltyApplied", 0] },
              { $ifNull: ["$tollFee", 0] }
            ]
          }
        }
      },
      {
        $group: {
          _id: "$driver",
          totalTrips: { $sum: 1 },
          totalEarnings: { $sum: "$effectiveTotal" }
        }
      }
    ]);

    const statsMap = new Map(driverStats.map((s) => [String(s._id), s]));
    const enrichedDrivers = drivers.map((d) => {
      const stat = statsMap.get(String(d._id));
      return {
        ...d,
        totalTrips: stat?.totalTrips || 0,
        totalEarnings: stat?.totalEarnings || 0
      };
    });

    res.json({ drivers: enrichedDrivers });
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

    const normalizedBookings = bookings.map((b) => {
      const booking = b.toObject();
      booking.totalFare =
        (booking.totalFare ?? 0) ||
        (booking.fare || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + (booking.tollFee || 0);
      return booking;
    });

    res.json({ bookings: normalizedBookings });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch bookings",
      error: error.message
    });
  }
};

// ================= MANUAL PAYMENT RESET =================
export const manualPaymentReset = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id);
        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }

        driver.pendingCommission = 0;
        driver.unpaidRideCount = 0;
        await driver.save();

        res.json({
            success: true,
            message: `Cleared dues for driver ${driver.name} successfully.`,
            driver
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to reset driver commission",
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
// ================= VERIFY DRIVER =================
export const verifyDriver = async (req, res) => {
  try {
    const { isVerified, verificationNote } = req.body;
    
    // If being verified, clear previous rejection notes
    const updateData = { isVerified };
    if (isVerified) {
      updateData.verificationNote = "";
    } else if (verificationNote !== undefined) {
      updateData.verificationNote = verificationNote;
    }

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select("-password");

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json({ 
      success: true, 
      message: isVerified ? "Driver verified successfully" : "Driver verification updated", 
      driver 
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to verify driver",
      error: error.message
    });
  }
};
