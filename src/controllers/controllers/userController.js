import { clearUserCache } from "../middleware/cacheMiddleware.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import Booking from "../models/Booking.js";

// ================= GET USER PROFILE =================
export const getProfile = async (req, res) => {
  try {
    const startTime = Date.now();
    const user = await User.findById(req.userId).select("-password");

    if (!user) {
      console.log(`[Profile] Fetched in ${Date.now() - startTime}ms (User not found)`);
      return res.status(404).json({
        message: "User not found"
      });
    }

    console.log(`[Profile] Fetched in ${Date.now() - startTime}ms for user ${req.userId}`);

    res.json({
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        gender: user.gender
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch profile",
      error: error.message
    });
  }
};

// ================= UPDATE USER PROFILE =================
export const updateProfile = async (req, res) => {
  try {
    const { name, mobile, email, gender } = req.body;

    // Check if mobile is being changed and if it's already taken
    if (mobile) {
      const existingUser = await User.findOne({ mobile, _id: { $ne: req.userId } });
      if (existingUser) {
        return res.status(400).json({
          message: "Mobile number already registered"
        });
      }
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (mobile) updateData.mobile = mobile;
    if (email !== undefined) updateData.email = email;
    if (gender !== undefined) updateData.gender = gender;
    if (req.body.pushToken !== undefined) updateData.pushToken = req.body.pushToken;

    const user = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    if (req.userId) await clearUserCache(req.userId, 'user');
    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        gender: user.gender
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update profile",
      error: error.message
    });
  }
};

// ================= GET USER HISTORY =================
export const getHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { bookingType, rideType } = req.query;
    console.log('[History Request] Query Raw:', req.query);
    const query = { user: req.userId };

    if (bookingType === 'now') {
      query.bookingType = 'now';
      query.status = { $ne: 'scheduled' };
    } else if (bookingType === 'schedule') {
      query.bookingType = 'schedule';
      query.status = 'scheduled';
    } else if (bookingType && bookingType !== 'all') {
      query.bookingType = bookingType;
    }

    if (rideType && rideType !== 'all') {
      query.rideType = rideType;
    }

    console.log('[History Mongo Query]:', JSON.stringify(query));

    console.log('[History] Filter params:', { bookingType, rideType });
    console.log('[History] Mongo Query:', query);

    // Parallelize data fetching and count for speed
    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(query)
    ]);

    console.log(`[History] Found ${bookings.length} rides for query`);

    const normalizedBookings = bookings.map((booking) => {
      const obj = booking.toObject();
      obj.totalFare = (obj.fare || 0) + (obj.returnTripFare || 0) + (obj.penaltyApplied || 0) + (obj.tollFee || 0);
      return obj;
    });

    res.json({
      bookings: normalizedBookings || [],
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch history",
      error: error.message
    });
  }
};

// ================= CHANGE PASSWORD =================
export const changePassword = async (req, res) => {
  try {
    await clearUserCache(req.userId, 'user');
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required"
      });
    }

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect"
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.userId, { password: hashedPassword });

    res.json({
      message: "Password changed successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to change password",
      error: error.message
    });
  }
};

// ================= SUBMIT REVIEW =================
export const submitReview = async (req, res) => {
  try {
    await clearUserCache(req.userId, 'user');
    const { bookingId, rating, feedback } = req.body;

    if (!bookingId || !rating) {
      return res.status(400).json({
        message: "Booking ID and rating are required"
      });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Update Booking with Review
    booking.rating = rating;
    booking.feedback = feedback || "";
    await booking.save();

    // Update Driver Rating (Simple Average)
    if (booking.driver) {
      const Driver = (await import("../models/Driver.js")).default;
      const driver = await Driver.findById(booking.driver);
      if (driver) {
        const totalRatings = driver.totalRatings || 0;
        const currentRating = driver.rating || 5;

        // New Rating Calculation
        const newRating = ((currentRating * totalRatings) + rating) / (totalRatings + 1);

        driver.rating = parseFloat(newRating.toFixed(1));
        driver.totalRatings = totalRatings + 1;
        await driver.save();
      }
    }

    res.json({
      message: "Review submitted successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to submit review",
      error: error.message
    });
  }
};
