import Driver from "../models/Driver.js";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import Review from "../models/Review.js";
import { createNotification } from "./notificationController.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Payout from "../models/Payout.js";
import Transaction from "../models/Transaction.js";
import { serverLog } from "../utils/logger.js";
import { getIO } from "../utils/socketLogic.js";

import { sendPushNotification } from "../utils/notifications.js";
import { uploadToImageKit } from "../utils/imagekit.js";

// ================= GENERATE JWT TOKEN FOR DRIVER =================
const generateDriverToken = (driverId) => {
  return jwt.sign(
    { driverId },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};

// ================= DRIVER REGISTRATION =================
export const registerDriver = async (req, res) => {
  try {
    const { name, mobile, password, vehicleNumber, vehicleModel, vehicleType, serviceType } = req.body;

    if (!name || !mobile || !password || !vehicleNumber || !vehicleModel) {
      return res.status(400).json({
        message: "All fields are required: name, mobile, password, vehicleNumber, vehicleModel"
      });
    }

    const existingDriver = await Driver.findOne({ mobile });
    if (existingDriver) {
      return res.status(400).json({
        message: "Mobile number already registered as a driver"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const vType = vehicleType || "5seater";
    let sType = serviceType || "cab";

    const driver = await Driver.create({
      name,
      mobile,
      password: hashedPassword,
      vehicleNumber,
      vehicleModel,
      vehicleType: vType,
      serviceType: sType,
      available: true
    });

    const token = generateDriverToken(driver._id);

    res.status(201).json({
      message: "Driver registered successfully",
      token,
      driver: {
        id: driver._id,
        name: driver.name,
        mobile: driver.mobile,
        vehicleModel: driver.vehicleModel,
        vehicleNumber: driver.vehicleNumber,
        vehicleType: driver.vehicleType,
        serviceType: driver.serviceType,
        rating: driver.rating,
        available: driver.available,
        online: driver.online || false
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Driver registration failed",
      error: error.message
    });
  }
};

// ================= DRIVER LOGIN =================
export const loginDriver = async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({
        message: "Mobile and password are required"
      });
    }

    const driver = await Driver.findOne({ mobile });
    if (!driver) {
      return res.status(400).json({
        message: "Invalid mobile or password"
      });
    }

    const isMatch = await bcrypt.compare(password, driver.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid mobile or password"
      });
    }

    const token = generateDriverToken(driver._id);

    res.json({
      message: "Login successful",
      token,
      driver: {
        id: driver._id,
        name: driver.name,
        mobile: driver.mobile,
        vehicleModel: driver.vehicleModel,
        vehicleNumber: driver.vehicleNumber,
        vehicleType: driver.vehicleType,
        serviceType: driver.serviceType,
        rating: driver.rating,
        available: driver.available,
        latitude: driver.latitude,
        longitude: driver.longitude,
        online: driver.online || false
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Driver login failed",
      error: error.message
    });
  }
};

// ================= GET NEARBY DRIVERS =================
export const getNearbyDrivers = async (req, res) => {
  try {
    const { latitude, longitude, serviceType } = req.query;

    const query = {
      available: true,
      online: true,
    };

    if (latitude && longitude) {
      query.location = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: 5000, // 5km
        },
      };
    }

    if (serviceType) {
      query.serviceType = serviceType;
    }

    const drivers = await Driver.find(query).select("-password");

    res.json({
      success: true,
      data: drivers.map(d => ({
        id: d._id,
        name: d.name,
        vehicleModel: d.vehicleModel,
        vehicleNumber: d.vehicleNumber,
        rating: d.rating,
        latitude: d.latitude,
        longitude: d.longitude,
        location: d.location
      }))
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch drivers",
      error: error.message
    });
  }
};

// ================= GET DRIVER BY ID =================
export const getDriverById = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id).select("-password");

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    res.json({
      driver: {
        id: driver._id,
        name: driver.name,
        mobile: driver.mobile,
        vehicleModel: driver.vehicleModel,
        vehicleNumber: driver.vehicleNumber,
        vehicleType: driver.vehicleType,
        serviceType: driver.serviceType,
        rating: driver.rating,
        available: driver.available,
        latitude: driver.latitude,
        longitude: driver.longitude
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch driver",
      error: error.message
    });
  }
};

// ================= GET DRIVER PROFILE =================
export const getDriverProfile = async (req, res) => {
  try {
    const driver = await Driver.findById(req.driverId).select("-password").lean();

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    // Run independent stats queries in parallel to reduce profile API latency.
    const [
      completedBookings,
      cancelledBookings,
      totalEarningsAgg,
      reviewAgg
    ] = await Promise.all([
      Booking.countDocuments({
        driver: req.driverId,
        status: "completed"
      }),
      Booking.countDocuments({
        driver: req.driverId,
        status: "cancelled"
      }),
      Booking.aggregate([
        { $match: { driver: driver._id, status: "completed" } },
        {
          $project: {
            effectiveTotal: {
              $add: ["$fare", { $ifNull: ["$returnTripFare", 0] }, { $ifNull: ["$penaltyApplied", 0] }, { $ifNull: ["$tollFee", 0] }]
            }
          }
        },
        { $group: { _id: null, total: { $sum: "$effectiveTotal" } } }
      ]),
      Review.aggregate([
        { $match: { driver: driver._id } },
        { $group: { _id: null, avgRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
      ])
    ]);

    const totalEarnings = totalEarningsAgg[0]?.total || 0;
    const avgRating = reviewAgg[0]?.avgRating ?? driver.rating;

    res.json({
      driver: {
        id: driver._id,
        name: driver.name,
        mobile: driver.mobile,
        vehicleModel: driver.vehicleModel,
        vehicleNumber: driver.vehicleNumber,
        vehicleType: driver.vehicleType,
        serviceType: driver.serviceType,
        rating: Math.round(avgRating * 10) / 10,
        available: driver.available,
        latitude: driver.latitude,
        longitude: driver.longitude,
        createdAt: driver.createdAt,
        experienceYears: driver.experienceYears,
        vehicleColor: driver.vehicleColor,
        profileImage: driver.profileImage || "",
        isVerified: driver.isVerified || false,
        verificationNote: driver.verificationNote || "",
        documents: driver.documents,
        stats: {
          totalBookings: completedBookings + cancelledBookings,
          completedBookings: completedBookings,
          totalEarnings,
          cancelledBookings
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch driver profile",
      error: error.message
    });
  }
};

// ================= UPDATE DRIVER PROFILE =================
export const updateDriverProfile = async (req, res) => {
  try {
    const { name, mobile, experienceYears } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (experienceYears !== undefined) updateData.experienceYears = experienceYears;
    if (mobile) {
      // Check if mobile is already taken by another driver
      const existingDriver = await Driver.findOne({
        mobile,
        _id: { $ne: req.driverId }
      });
      if (existingDriver) {
        return res.status(400).json({
          message: "Mobile number already in use"
        });
      }
      updateData.mobile = mobile;
    }

    const driver = await Driver.findByIdAndUpdate(
      req.driverId,
      updateData,
      { new: true }
    ).select("-password");

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    res.json({
      message: "Profile updated successfully",
      driver: {
        id: driver._id,
        name: driver.name,
        mobile: driver.mobile,
        vehicleModel: driver.vehicleModel,
        vehicleNumber: driver.vehicleNumber,
        vehicleType: driver.vehicleType,
        serviceType: driver.serviceType,
        rating: driver.rating,
        experienceYears: driver.experienceYears,
        available: driver.available
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update driver profile",
      error: error.message
    });
  }
};

// ================= UPDATE VEHICLE DETAILS =================
export const updateVehicleDetails = async (req, res) => {
  try {
    const { vehicleNumber, vehicleModel, vehicleColor, vehicleType, serviceType, pushToken } = req.body;

    const updateData = {};
    if (vehicleNumber) updateData.vehicleNumber = vehicleNumber;
    if (vehicleModel) updateData.vehicleModel = vehicleModel;
    if (vehicleColor) updateData.vehicleColor = vehicleColor;
    if (vehicleType) updateData.vehicleType = vehicleType;
    if (pushToken) updateData.pushToken = pushToken;

    // Simplified serviceType handling
    if (serviceType) {
      updateData.serviceType = serviceType;
    }

    const driver = await Driver.findByIdAndUpdate(
      req.driverId,
      updateData,
      { new: true }
    ).select("-password");

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    res.json({
      message: "Vehicle details updated successfully",
      driver: {
        id: driver._id,
        name: driver.name,
        vehicleModel: driver.vehicleModel,
        vehicleNumber: driver.vehicleNumber,
        vehicleColor: driver.vehicleColor,
        vehicleType: driver.vehicleType,
        serviceType: driver.serviceType
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update vehicle details",
      error: error.message
    });
  }
};

// ================= UPDATE DRIVER DOCUMENTS =================
export const updateDocuments = async (req, res) => {
  try {
    const { license, insurance, registration } = req.body;
    const updateData = {};

    // Helper to handle base64 uploads
    const handleDocumentUpload = async (docData, fieldName) => {
      if (!docData) return;
      
      // If it's already a URL, skip upload
      if (docData.startsWith('http')) {
        updateData[`documents.${fieldName}`] = docData;
        return;
      }
      
      // If it's base64, upload to ImageKit
      if (docData.startsWith('data:')) {
        const fileName = `${fieldName}_${req.driverId}_${Date.now()}.jpg`;
        const uploadResponse = await uploadToImageKit(docData, fileName, "/documents");
        updateData[`documents.${fieldName}`] = uploadResponse.url;
      }
    };

    await Promise.all([
      handleDocumentUpload(license, 'license'),
      handleDocumentUpload(insurance, 'insurance'),
      handleDocumentUpload(registration, 'registration')
    ]);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No document data provided" });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.driverId,
      { $set: updateData },
      { new: true }
    ).select("-password");

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    res.json({
      message: "Documents updated successfully",
      documents: driver.documents
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update documents",
      error: error.message
    });
  }
};

// ================= UPDATE BOOKING TOLL =================
export const updateTollFee = async (req, res) => {
  try {
    const { tollFee } = req.body;
    const parsedToll = Number(tollFee);

    if (!Number.isFinite(parsedToll) || parsedToll < 0) {
      return res.status(400).json({ message: "Valid toll fee is required" });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!booking.driver || booking.driver.toString() !== req.driverId.toString()) {
      return res.status(403).json({ message: "Not authorized to update toll for this booking" });
    }

    if (["completed", "cancelled"].includes(booking.status)) {
      return res.status(400).json({ message: "Cannot update toll for completed/cancelled booking" });
    }

    booking.tollFee = parsedToll;
    booking.totalFare = (booking.fare || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + parsedToll;
    await booking.save();

    try {
      const io = getIO();
      const rooms = [booking.user.toString(), booking.driver.toString()];
      rooms.forEach((room) => {
        io.to(room).emit("tollFeeUpdated", {
          bookingId: booking._id.toString(),
          tollFee: booking.tollFee,
          totalFare: booking.totalFare
        });
      });
    } catch (socketError) {
      serverLog(`tollFeeUpdated socket error: ${socketError.message}`);
    }

    res.json({
      message: "Toll fee updated successfully",
      tollFee: booking.tollFee,
      totalFare: booking.totalFare
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to update toll fee", error: error.message });
  }
};

// Helper for proximity detection (Haversine distance in meters)
const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Radius of the earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// ================= UPDATE DRIVER LOCATION =================
export const updateDriverLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: "Latitude and longitude are required"
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.driverId,
      {
        latitude,
        longitude,
        location: {
          type: "Point",
          coordinates: [longitude, latitude]
        },
        lastLocationUpdate: new Date()
      },
      { new: true }
    ).select("-password");

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    res.json({
      message: "Location updated successfully",
      driver: {
        id: driver._id,
        latitude: driver.latitude,
        longitude: driver.longitude,
        location: driver.location
      }
    });

    // Broadcast update if there's an active booking
    try {
      if (driver.currentBooking) {
        const io = getIO();
        io.to(driver.currentBooking.toString()).emit("driverLocationUpdate", {
          bookingId: driver.currentBooking,
          latitude: latitude,
          longitude: longitude
        });

        // Also broadcast to user room for safety
        const activeBooking = await Booking.findById(driver.currentBooking);
        if (activeBooking) {
          io.to(activeBooking.user.toString()).emit("driverLocationUpdate", {
            bookingId: activeBooking._id,
            latitude: latitude,
            longitude: longitude
          });

          // Proximity detection: if within 100m of pickup and notification not yet sent
          if (activeBooking.status === "accepted" && !activeBooking.nearbyNotificationSent) {
            const distance = getDistanceInMeters(
              latitude, longitude,
              activeBooking.pickupLatitude, activeBooking.pickupLongitude
            );

            if (distance <= 100) {
              activeBooking.nearbyNotificationSent = true;
              await activeBooking.save();

              await createNotification({
                userId: activeBooking.user,
                title: "Driver is Nearby",
                body: "Your driver is less than 100m away. Please get ready for your ride.",
                type: "ride_nearby",
                bookingId: activeBooking._id
              });
              serverLog(`Proximity alert sent: Driver ${req.driverId} is within ${Math.round(distance)}m of user ${activeBooking.user}`);
            }
          }
        }
      } else {
        // Fallback for logic safety
        const activeBooking = await Booking.findOne({
          driver: req.driverId,
          status: { $in: ["accepted", "arrived", "started"] }
        });
        if (activeBooking) {
          const io = getIO();
          io.to(activeBooking.user.toString()).emit("driverLocationUpdate", {
            bookingId: activeBooking._id,
            latitude: latitude,
            longitude: longitude
          });
        }
      }
    } catch (socketError) {
      serverLog(`Socket broadcast error: ${socketError.message}`);
    }
  } catch (error) {
    res.status(500).json({
      message: "Failed to update location",
      error: error.message
    });
  }
};

// ================= TOGGLE DRIVER AVAILABILITY =================
export const toggleAvailability = async (req, res) => {
  try {
    const driver = await Driver.findById(req.driverId);

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    driver.available = !driver.available;
    await driver.save();

    res.json({
      message: driver.available ? "Driver is now available" : "Driver is now unavailable",
      available: driver.available
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to toggle availability",
      error: error.message
    });
  }
};

// ================= TOGGLE DRIVER ONLINE STATUS =================
export const toggleOnlineStatus = async (req, res) => {
  try {
    const driver = await Driver.findById(req.driverId);

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    const now = new Date();

    if (driver.online) {
      // Transitioning from ONLINE to OFFLINE
      if (driver.lastOnlineToggle) {
        const diffMs = now - driver.lastOnlineToggle;
        const diffMins = Math.floor(diffMs / 60000);
        driver.onlineTime = (driver.onlineTime || 0) + diffMins;
      }
      driver.online = false;
      driver.available = false;
      driver.lastOnlineToggle = now;
    } else {
      // Transitioning from OFFLINE to ONLINE
      driver.online = true;
      driver.available = true; // Fix: Ensure driver is available when going online
      driver.lastOnlineToggle = now;
    }

    await driver.save();

    res.json({
      message: driver.online ? "Driver is now online" : "Driver is now offline",
      online: driver.online,
      available: driver.available,
      onlineTime: driver.onlineTime
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to toggle online status",
      error: error.message
    });
  }
};

// ================= GET AVAILABLE BOOKINGS =================
export const getAvailableBookings = async (req, res) => {
  try {
    // Get bookings that are pending or need a driver
    const bookings = await Booking.find({
      status: { $in: ["pending", "driver_assigned"] },
      driver: { $in: [null, req.driverId] }
    })
      .populate("user", "name mobile")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      bookings: bookings.map(booking => ({
        id: booking._id,
        pickupLocation: booking.pickupLocation,
        pickupLatitude: booking.pickupLatitude,
        pickupLongitude: booking.pickupLongitude,
        dropLocation: booking.dropLocation,
        dropLatitude: booking.dropLatitude,
        dropLongitude: booking.dropLongitude,
        rideType: booking.rideType,
        bookingType: booking.bookingType,
        status: booking.status,
        fare: booking.fare,
        distance: booking.distance,
        scheduledDate: booking.scheduledDate,
        user: booking.user
      }))
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch available bookings",
      error: error.message
    });
  }
};

// ================= GET CURRENT BOOKING =================
export const getCurrentBooking = async (req, res) => {
  try {
    const driver = await Driver.findById(req.driverId);

    let booking;
    if (driver && driver.currentBooking) {
      booking = await Booking.findById(driver.currentBooking)
        .populate("user", "name mobile profileImage")
        .populate("driver", "name mobile vehicleModel vehicleNumber rating latitude longitude location");
    }

    // Fallback if currentBooking is missing or stale - includes all active statuses
    if (!booking) {
      booking = await Booking.findOne({
        driver: req.driverId,
        status: { $in: ["accepted", "driver_assigned", "arrived", "started", "waiting", "return_ride_started"] }
      })
        .sort({ createdAt: -1 })
        .populate("user", "name mobile profileImage")
        .populate("driver", "name mobile vehicleModel vehicleNumber rating latitude longitude location");

      if (booking) {
        await Driver.findByIdAndUpdate(req.driverId, { currentBooking: booking._id });
      }
    }

    if (booking && (booking.status === "cancelled" || booking.status === "completed")) {
      await Driver.findByIdAndUpdate(req.driverId, { currentBooking: null, available: true });
      return res.status(404).json({ message: "No active booking found" });
    }

    if (!booking) {
      return res.status(404).json({ message: "No active booking found" });
    }

    // Trigger penalty calculation if driver is in waiting phase
    if (booking.waitingStartedAt) {
      await calculateAndUpdatePenalty(booking);
    }

    res.json({
      booking: {
        id: booking._id,
        pickupLocation: booking.pickupLocation,
        pickupLatitude: booking.pickupLatitude,
        pickupLongitude: booking.pickupLongitude,
        dropLocation: booking.dropLocation,
        dropLatitude: booking.dropLatitude,
        dropLongitude: booking.dropLongitude,
        rideType: booking.rideType,
        status: booking.status,
        otp: booking.otp,
        fare: booking.fare,
        distance: booking.distance,
        paymentMethod: booking.paymentMethod,
        user: booking.user,
        driver: booking.driver,
        hasReturnTrip: booking.hasReturnTrip,
        returnTripFare: booking.returnTripFare,
        penaltyApplied: booking.penaltyApplied || 0,
        tollFee: booking.tollFee || 0,
        waitingStartedAt: booking.waitingStartedAt,
        waitingLimit: booking.waitingLimit,
        firstLegPaid: booking.firstLegPaid || false,
        paymentChoice: booking.paymentChoice || "leg_by_leg",
        nightSurcharge: booking.nightSurcharge || 0,
        createdAt: booking.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch current booking",
      error: error.message
    });
  }
};


// ================= ACCEPT BOOKING =================
export const acceptBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (booking.status !== "pending" && booking.status !== "driver_assigned") {
      return res.status(400).json({
        message: "This booking cannot be accepted"
      });
    }

    // Prevent accepting if already has an active ride or not verified
    const driver = await Driver.findById(req.driverId);
    
    if (!driver.isVerified) {
      return res.status(403).json({
        message: "Your account is pending verification. You can accept rides once an admin approves your documents."
      });
    }

    if (driver.unpaidRideCount >= 3 && driver.pendingCommission > 0) {
      return res.status(403).json({
        message: "Aapka 3 rides ka commission pending hai. Kripya pahle payment karein.",
        pendingCommission: driver.pendingCommission,
        requiresPayment: true
      });
    }

    if (driver.currentBooking) {
      const activeCheck = await Booking.findById(driver.currentBooking);
      if (activeCheck && !["completed", "cancelled"].includes(activeCheck.status)) {
        return res.status(400).json({
          message: "You already have an active ride"
        });
      }
    }

    // Update booking with driver
    booking.driver = req.driverId;
    booking.status = "accepted";
    await booking.save();
    serverLog(`Booking ${booking._id} accepted by driver ${req.driverId}`);

    // Make driver unavailable and track current ride
    driver.available = false;
    driver.currentBooking = booking._id;
    await driver.save();

    const populatedBooking = await Booking.findById(booking._id)
      .populate("user", "name mobile profileImage")
      .populate("driver", "name mobile vehicleModel vehicleNumber rating vehicleType profileImage latitude longitude location");

    // NOTIFY USER via Socket
    const { getIO: ioGetter } = await import("../utils/socketLogic.js");
    const io = ioGetter();
    io.to(populatedBooking.user._id.toString()).emit("rideAccepted", {
      booking: {
        id: populatedBooking._id,
        status: populatedBooking.status,
        driver: {
          name: populatedBooking.driver.name,
          mobile: populatedBooking.driver.mobile,
          vehicleModel: populatedBooking.driver.vehicleModel,
          vehicleNumber: populatedBooking.driver.vehicleNumber,
          vehicleType: populatedBooking.driver.vehicleType,
          rating: populatedBooking.driver.rating,
          profileImage: populatedBooking.driver.profileImage
        }
      }
    });

    // Notify other drivers to hide this request
    io.emit("rideRequestCancelled", {
      bookingId: populatedBooking._id.toString()
    });

    // Create persistent notification for user
    await createNotification({
      userId: populatedBooking.user._id,
      title: "Ride Accepted",
      body: `Driver ${populatedBooking.driver.name} has accepted your ride. They are on their way!`,
      type: "ride_accepted",
      bookingId: populatedBooking._id
    });

    // Send Push Notification to User
    if (populatedBooking.user && populatedBooking.user.pushToken) {
      sendPushNotification(
        populatedBooking.user.pushToken,
        "Ride Accepted",
        `Driver ${populatedBooking.driver.name} has accepted your ride. They are on their way!`,
        { bookingId: populatedBooking._id.toString(), type: 'ride_accepted' }
      );
    }

    res.json({
      message: "Booking accepted successfully",
      booking: {
        id: populatedBooking._id,
        pickupLocation: populatedBooking.pickupLocation,
        pickupLatitude: populatedBooking.pickupLatitude,
        pickupLongitude: populatedBooking.pickupLongitude,
        dropLocation: populatedBooking.dropLocation,
        dropLatitude: populatedBooking.dropLatitude,
        dropLongitude: populatedBooking.dropLongitude,
        status: populatedBooking.status,
        otp: populatedBooking.otp,
        fare: populatedBooking.fare,
        user: populatedBooking.user,
        driver: populatedBooking.driver
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to accept booking",
      error: error.message
    });
  }
};

// ================= REJECT BOOKING =================
export const rejectBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (booking.driver && booking.driver.toString() !== req.driverId) {
      return res.status(403).json({
        message: "You cannot reject this booking"
      });
    }

    // Reset driver assignment
    if (booking.driver && booking.driver.toString() === req.driverId) {
      booking.driver = null;
      booking.status = "pending";
      await booking.save();

      // Make driver available again
      await Driver.findByIdAndUpdate(req.driverId, { available: true });
    }

    res.json({
      message: "Booking rejected successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to reject booking",
      error: error.message
    });
  }
};

// ================= UPDATE BOOKING STATUS =================
export const updateBookingStatus = async (req, res) => {
  try {
    const { status, fare, distance } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (booking.driver && booking.driver.toString() !== req.driverId) {
      return res.status(403).json({
        message: "You are not authorized to update this booking"
      });
    }

    // Validate status transitions
    const validTransitions = {
      "accepted": ["arrived"],
      "arrived": ["started"],
      "started": ["completed", "waiting"],
      "waiting": ["return_ride_started", "completed"],
      "return_ride_started": ["completed"],
      "completed": [],
      "cancelled": []
    };

    if (!validTransitions[booking.status]?.includes(status)) {
      return res.status(400).json({
        message: `Cannot transition from ${booking.status} to ${status}`
      });
    }

    booking.status = status;

    if (status === "arrived") {
      booking.driverArrivedAt = new Date();
    }

    if (status === "completed") {
      // Preserve base fare and always compute the final trip total
      if (!booking.fare || booking.fare === 0) {
        booking.fare = fare || 0;
      }
      booking.totalFare = (booking.fare || 0) + (booking.nightSurcharge || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + (booking.tollFee || 0);
      booking.distance = distance || booking.distance || 0;
      booking.paymentStatus = booking.paymentStatus === "paid" ? "paid" : "pending";

      // Make driver available again
      await Driver.findByIdAndUpdate(req.driverId, { available: true });
    }

    // CRITICAL: Save to DB before emitting socket events to avoid race conditions on client refresh
    await booking.save();
    serverLog(`Booking status successfully updated and saved: ${status} for booking ${booking._id}`);

    // Emit socket events for real-time updates
    try {
      const io = getIO();
      const userRoom = booking.user.toString();

      // Unified event for status update
      io.to(userRoom).emit("rideStatusUpdate", {
        bookingId: booking._id.toString(),
        status: status,
        message: `Ride status updated to ${status}`
      });
      serverLog(`rideStatusUpdate [${status}] emitted to room ${userRoom}`);

      // Special event and message for Arrival
      if (status === "arrived") {
        io.to(userRoom).emit("driverArrived", {
          bookingId: booking._id.toString(),
          message: "Your driver has arrived at the pickup location!"
        });
        serverLog(`driverArrived specific event emitted to room ${userRoom}`);

        // Create persistent notification
        await createNotification({
          userId: booking.user,
          title: "Driver Arrived",
          body: "Your driver has arrived at the pickup location. Please proceed to the vehicle.",
          type: "ride_arrived",
          bookingId: booking._id
        });

        // Send Push Notification to User
        const foundUser = await User.findById(booking.user);
        if (foundUser && foundUser.pushToken) {
          sendPushNotification(
            foundUser.pushToken,
            "Driver Arrived",
            "Your driver has arrived at the pickup location. Please proceed to the vehicle.",
            { bookingId: booking._id.toString(), type: 'ride_arrived' }
          );
        }
      }

      if (status === "completed") {
        await createNotification({
          userId: booking.user,
          title: "Ride Completed",
          body: `Your ride is completed. Final fare: ₹${booking.totalFare}. Hope you had a great trip!`,
          type: "ride_completed",
          bookingId: booking._id
        });
      }
    } catch (socketError) {
      serverLog(`Socket notification error: ${socketError.message}`);
    }

    const populatedBooking = await Booking.findById(booking._id)
      .populate("user", "name mobile")
      .populate("driver", "name mobile vehicleModel vehicleNumber rating");

    res.json({
      message: `Booking status updated to ${status}`,
      booking: {
        id: populatedBooking._id,
        pickupLocation: populatedBooking.pickupLocation,
        dropLocation: populatedBooking.dropLocation,
        status: populatedBooking.status,
        fare: populatedBooking.fare,
        distance: populatedBooking.distance,
        paymentStatus: populatedBooking.paymentStatus,
        user: populatedBooking.user,
        driver: populatedBooking.driver
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update booking status",
      error: error.message
    });
  }
};

// ================= GET DRIVER BOOKING HISTORY =================
export const getDriverHistory = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      rideType,
      paymentStatus,
      dateFrom,
      dateTo,
      search
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

    const filters = { driver: req.driverId };
    if (status && status !== "all") {
      filters.status = status;
    }
    if (rideType && rideType !== "all") {
      filters.rideType = rideType;
    }
    if (paymentStatus && paymentStatus !== "all") {
      filters.paymentStatus = paymentStatus;
    }
    if (dateFrom || dateTo) {
      filters.createdAt = {};
      if (dateFrom) filters.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filters.createdAt.$lte = new Date(dateTo);
    }
    if (search && String(search).trim().length > 0) {
      const text = String(search).trim();
      filters.$or = [
        { pickupLocation: { $regex: text, $options: "i" } },
        { dropLocation: { $regex: text, $options: "i" } }
      ];
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filters)
      .populate("user", "name mobile")
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum),
      Booking.countDocuments(filters)
    ]);

    res.json({
      bookings: bookings.map(booking => ({
        id: booking._id,
        pickupLocation: booking.pickupLocation,
        dropLocation: booking.dropLocation,
        rideType: booking.rideType,
        bookingType: booking.bookingType,
        status: booking.status,
        fare: booking.fare,
        tollFee: booking.tollFee || 0,
        penaltyApplied: booking.penaltyApplied || 0,
        returnTripFare: booking.returnTripFare || 0,
        hasReturnTrip: !!booking.hasReturnTrip,
        totalFare: (booking.fare || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + (booking.tollFee || 0),
        distance: booking.distance,
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod || "cash",
        nightFareAmount: booking.nightFareAmount || booking.nightFare || booking.nightCharge || 0,
        isNightFare: !!booking.isNightFare,
        nightFareApplied: !!booking.nightFareApplied,
        scheduledDate: booking.scheduledDate || null,
        user: booking.user,
        rating: booking.rating || 0,
        feedback: booking.feedback || "",
        createdAt: booking.createdAt
      })),
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum
      },
      filters: {
        status: status || "all",
        rideType: rideType || "all",
        paymentStatus: paymentStatus || "all",
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        search: search || ""
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch booking history",
      error: error.message
    });
  }
};

// ================= GET DRIVER EARNINGS =================
export const getDriverEarnings = async (req, res) => {
  try {
    const { 
      period = "week", 
      dateFrom, 
      dateTo,
      txPage = 1,
      txLimit = 20,
      commPage = 1,
      commLimit = 20
    } = req.query;

    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    let endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const now = new Date();
    
    if (period === "custom" && dateFrom && dateTo) {
      startDate = new Date(dateFrom);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
    } else {
      switch (period) {
        case "day":
          // Today 00:00 to 23:59
          break;
        case "week":
          startDate.setDate(now.getDate() - 7);
          break;
        case "month":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "all":
          startDate = new Date(0);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }
    }

    const bookingFare = (booking) => {
      if (booking.totalFare && booking.totalFare > 0) return booking.totalFare;
      return (Number(booking.fare) || 0) + 
             (Number(booking.nightSurcharge) || 0) + 
             (Number(booking.returnTripFare) || 0) + 
             (Number(booking.penaltyApplied) || 0) + 
             (Number(booking.tollFee) || 0);
    };

    const commonFilter = { driver: req.driverId };
    const periodFilter = { ...commonFilter, status: "completed" };
    if (period !== "all") {
      periodFilter.createdAt = { $gte: startDate, $lte: endDate };
    }

    const txPageNum = Math.max(parseInt(txPage) || 1, 1);
    const txLimitNum = Math.min(Math.max(parseInt(txLimit) || 20, 1), 50);
    const commPageNum = Math.max(parseInt(commPage) || 1, 1);
    const commLimitNum = Math.min(Math.max(parseInt(commLimit) || 20, 1), 50);

    const txFilter = { driver: req.driverId };
    if (period !== "all") {
      txFilter.createdAt = { $gte: startDate, $lte: endDate };
    }

    const commFilterObj = { 
      driver: req.driverId, 
      status: "completed",
      adminCommission: { $gt: 0 }
    };
    if (period !== "all") {
      commFilterObj.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Parallel execution of all data requirements
    const [
      periodBookings,
      calendarBookings,
      driver,
      payouts,
      transactions,
      txTotal,
      rideCommissions,
      commTotal
    ] = await Promise.all([
      Booking.find(periodFilter).sort({ createdAt: 1 }),
      Booking.find({ driver: req.driverId, status: "completed" }).select('createdAt fare totalFare nightSurcharge returnTripFare penaltyApplied tollFee'),
      Driver.findById(req.driverId),
      Payout.find({ driver: req.driverId, createdAt: { $gte: startDate, $lte: endDate } }).sort({ createdAt: -1 }),
      Transaction.find(txFilter).sort({ createdAt: -1 }).limit(txLimitNum).skip((txPageNum - 1) * txLimitNum),
      Transaction.countDocuments(txFilter),
      Booking.find(commFilterObj).select('pickupLocation dropLocation totalFare fare adminCommission createdAt').sort({ createdAt: -1 }).limit(commLimitNum).skip((commPageNum - 1) * commLimitNum),
      Booking.countDocuments(commFilterObj)
    ]);

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    // Process daily stats for calendar dots
    const dailyStats = {};
    calendarBookings.forEach(booking => {
      const dateKey = booking.createdAt.toISOString().split('T')[0];
      dailyStats[dateKey] = (dailyStats[dateKey] || 0) + bookingFare(booking);
    });

    const periodEarnings = periodBookings.reduce((sum, booking) => sum + bookingFare(booking), 0);
    const periodTrips = periodBookings.length;
    const periodAvgFare = periodTrips > 0 ? (periodEarnings / periodTrips).toFixed(0) : 0;
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEarnings = periodBookings
      .filter(b => b.createdAt >= todayStart)
      .reduce((sum, booking) => sum + bookingFare(booking), 0);

    const onlineHours = Math.round(((driver.onlineTime || 0) / 60) * 10) / 10;

    res.json({
      earnings: {
        totalEarnings: periodEarnings,
        totalTrips: periodTrips,
        averageFare: periodAvgFare,
        todayEarnings,
        lifetimeBalance: driver.totalEarnings || 0,
        pendingCommission: driver.pendingCommission || 0,
        unpaidRideCount: driver.unpaidRideCount || 0,
        onlineHours,
        period,
        dailyStats,
        transactions,
        txPagination: {
          total: txTotal,
          page: txPageNum,
          pages: Math.ceil(txTotal / txLimitNum)
        },
        rideCommissions,
        commPagination: {
          total: commTotal,
          page: commPageNum,
          pages: Math.ceil(commTotal / commLimitNum)
        },
        activities: payouts.map(p => ({
          id: p._id,
          type: "payout",
          amount: p.amount,
          status: p.status,
          method: p.paymentMethod,
          date: p.createdAt
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch earnings",
      error: error.message
    });
  }
};

// ================= GET DRIVER REVIEWS =================
export const getDriverReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const driver = await Driver.findById(req.driverId);

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    const reviews = await Review.find({ driver: req.driverId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("user", "name profileImage");

    const totalReviews = await Review.countDocuments({ driver: req.driverId });

    const formattedReviews = reviews.map(review => ({
      id: review._id,
      userName: review.user ? review.user.name : "Anonymous",
      userImage: review.user ? review.user.profileImage : null,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt
    }));

    res.json({
      reviews: formattedReviews,
      averageRating: driver.rating,
      totalReviews: totalReviews,
      pagination: {
        page: parseInt(page),
        pages: Math.ceil(totalReviews / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch reviews",
      error: error.message
    });
  }
};

// ================= VERIFY RIDE OTP =================
export const verifyRideOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const { id } = req.params;

    serverLog(`OTP Verification Attempt: Booking ${id}, OTP provided: ${otp}`);

    const booking = await Booking.findById(id);

    if (!booking) {
      serverLog(`OTP Verification Failed: Booking ${id} not found`);
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    // Safety check for driver
    if (booking.driver.toString() !== req.driverId.toString()) {
      serverLog(`OTP Verification Failed: Driver mismatch. Request: ${req.driverId}, Booking: ${booking.driver}`);
      return res.status(403).json({
        message: "Not authorized to verify this ride"
      });
    }

    if (String(booking.otp) !== String(otp)) {
      serverLog(`OTP Verification Failed: Mismatch. Expected: ${booking.otp}, Received: ${otp}`);
      return res.status(400).json({
        message: "Invalid OTP"
      });
    }

    booking.status = "started";
    booking.rideStartedAt = new Date();
    await booking.save();

    // Notify user that ride has started
    try {
      const io = getIO();
      io.to(booking.user.toString()).emit("rideStatusUpdate", {
        bookingId: booking._id.toString(),
        status: "started",
        message: "Your ride has started!"
      });

      // Create persistent notification
      await createNotification({
        userId: booking.user,
        title: "Ride Started",
        body: "Your ride has started. Have a safe journey!",
        type: "ride_started",
        bookingId: booking._id
      });

      // Send Push Notifications to User
      const user = await User.findById(booking.user);
      if (user && user.pushToken) {
        // 1. Ride Started Notification
        sendPushNotification(
          user.pushToken,
          "Ride Started",
          "Your ride has officially started. Have a safe journey!",
          { bookingId: booking._id.toString(), type: 'ride_started' }
        );

        // 2. Return Trip Offer Notification
        sendPushNotification(
          user.pushToken,
          "Limited Offer: 50% OFF Return Trip",
          "Book your return trip now and save 50%. Offer valid for this ride only!",
          { bookingId: booking._id.toString(), type: 'suggest_return' }
        );
      }

      // 3. Suggest Return Trip via Socket (For real-time popup)
      io.to(booking.user.toString()).emit("suggestReturnTrip", {
        bookingId: booking._id.toString(),
        waitingLimit: booking.waitingLimit,
        message: "Enjoy 50% OFF on your return trip! Accept now to book your return."
      });

      // 4. Persistent notification for the offer
      await createNotification({
        userId: booking.user,
        title: "Limited Offer: 50% OFF Return Trip",
        body: "Book your return trip now and save 50%. Offer valid for this ride only!",
        type: "suggest_return", // Changed from ride_accepted to suggest_return for better tracking
        bookingId: booking._id
      });
    } catch (socketError) {
      serverLog(`Socket notification error: ${socketError.message}`);
    }

    res.json({
      message: "OTP verified, ride started",
      booking: {
        id: booking._id,
        status: booking.status
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to verify OTP",
      error: error.message
    });
  }
};

// ================= COMPLETE RIDE =================
export const completeRide = async (req, res) => {
  try {
    const { fare, distance } = req.body;
    const booking = await Booking.findOne({
      driver: req.driverId,
      status: { $in: ["started", "waiting", "return_ride_started"] }
    });

    if (!booking) {
      return res.status(404).json({
        message: "No active ride found to complete"
      });
    }

    booking.status = "completed";
    // Preserve base fare and always compute the final trip total
    if (!booking.fare || booking.fare === 0) {
      booking.fare = fare || 0;
    }
    booking.totalFare = (booking.fare || 0) + (booking.nightSurcharge || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + (booking.tollFee || 0);
    booking.distance = distance || booking.distance || 0;
    booking.paymentStatus = booking.paymentStatus === "paid" ? "paid" : "pending";
    booking.rideCompletedAt = new Date();
    await booking.save();

    // Clear driver's active booking
    await Driver.findByIdAndUpdate(req.driverId, {
      currentBooking: null,
      available: true
    });

    // Notify User via Socket
    try {
      const io = getIO();
      const userRoom = booking.user.toString();
      io.to(userRoom).emit("rideStatusUpdate", {
        bookingId: booking._id.toString(),
        status: "completed",
        fare: booking.fare,
        totalFare: booking.totalFare,
        distance: booking.distance,
        message: "Ride completed"
      });

      // Create persistent notification
      await createNotification({
        userId: booking.user,
        title: "Ride Completed",
        body: `Your ride is completed. Final fare: ₹${booking.totalFare}. Hope you had a great trip!`,
        type: "ride_completed",
        bookingId: booking._id
      });
    } catch (socketError) {
      serverLog(`Socket notification error: ${socketError.message}`);
    }

    // Calculate 12% commission
    const commissionRate = 0.12;
    const adminCommission = Math.round((booking.totalFare || 0) * commissionRate);
    const driverEarnings = (booking.totalFare || 0) - adminCommission;

    booking.adminCommission = adminCommission;
    booking.driverEarnings = driverEarnings;
    await booking.save();

    // Make driver available again and update statistics/debt
    await Driver.findByIdAndUpdate(req.driverId, {
      available: true,
      $inc: {
        totalTrips: 1,
        totalEarnings: driverEarnings,
        pendingCommission: adminCommission,
        unpaidRideCount: 1
      }
    });

    res.json({
      message: "Ride completed successfully",
      booking: {
        id: booking._id,
        status: booking.status,
        fare: booking.fare,
        distance: booking.distance,
        paymentStatus: booking.paymentStatus
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to complete ride",
      error: error.message
    });
  }
};

// ================= CANCEL BOOKING (DRIVER) =================
export const cancelBooking = async (req, res) => {
  try {
    const { reason } = req.body;
    const booking = await Booking.findOne({
      _id: req.params.id,
      driver: req.driverId,
      status: { $nin: ["completed", "cancelled"] }
    });

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found or cannot be cancelled"
      });
    }

    booking.status = "cancelled";
    booking.cancellationReason = reason || "Cancelled by driver";
    await booking.save();

    // Make driver available again and clear current ride
    await Driver.findByIdAndUpdate(req.driverId, {
      available: true,
      currentBooking: null
    });

    // Notify User
    try {
      const { getIO } = await import("../utils/socketLogic.js");
      getIO().to(booking.user.toString()).emit("bookingCancelledByDriver", {
        bookingId: booking._id,
        message: "The driver has cancelled this ride."
      });

      // Create persistent notification
      await createNotification({
        userId: booking.user,
        title: "Ride Cancelled",
        body: `The driver has cancelled the ride. Reason: ${booking.cancellationReason}`,
        type: "ride_cancelled",
        bookingId: booking._id
      });
    } catch (socketError) {
      console.error(`Socket notification error: ${socketError.message}`);
    }

    res.json({
      message: "Booking cancelled successfully",
      booking: {
        id: booking._id,
        status: booking.status,
        cancellationReason: booking.cancellationReason
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to cancel booking",
      error: error.message
    });
  }
};

// ================= GET DASHBOARD STATS =================
export const getDriverDashboard = async (req, res) => {
  try {
    const driver = await Driver.findById(req.driverId).select("-password");

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Today's completed trips
    const todayTrips = await Booking.countDocuments({
      driver: req.driverId,
      status: "completed",
      createdAt: { $gte: today }
    });

    // Calculate real average rating for dashboard
    const allReviews = await Review.find({ driver: req.driverId });
    const avgRatingDash = allReviews.length > 0
      ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
      : driver.rating;

    // Today's earnings
    const todayBookings = await Booking.find({
      driver: req.driverId,
      status: "completed",
      createdAt: { $gte: today }
    });
    const todayEarnings = todayBookings.reduce(
      (sum, b) => sum + Number((b.fare || 0) + (b.nightSurcharge || 0) + (b.returnTripFare || 0) + (b.penaltyApplied || 0) + (b.tollFee || 0)),
      0
    );

    // Total completed trips
    const totalTrips = await Booking.countDocuments({
      driver: req.driverId,
      status: "completed"
    });

    // Pending bookings count
    const pendingBookings = await Booking.countDocuments({
      status: "pending"
    });

    // Current booking using explicit tracking
    let currentBooking = null;
    if (driver.currentBooking) {
      currentBooking = await Booking.findById(driver.currentBooking)
        .populate("user", "name mobile");
    }

    // Fallback only if needed (safety net)
    if (!currentBooking) {
      currentBooking = await Booking.findOne({
        driver: req.driverId,
        status: { $in: ["accepted", "driver_assigned", "arrived", "started", "waiting", "return_ride_started"] }
      }).sort({ createdAt: -1 }).populate("user", "name mobile");

      // If found via fallback, sync it to driver.currentBooking
      if (currentBooking) {
        await Driver.findByIdAndUpdate(req.driverId, { currentBooking: currentBooking._id });
      }
    }

    // Double-check: if booking exists but is cancelled/completed, clear it
    if (currentBooking && (currentBooking.status === "cancelled" || currentBooking.status === "completed")) {
      await Driver.findByIdAndUpdate(req.driverId, { currentBooking: null, available: true });
      currentBooking = null;
    }

    const totalEarningsAgg = await Booking.aggregate([
      { $match: { driver: driver._id, status: "completed" } },
      {
        $project: {
          effectiveTotal: {
            $add: ["$fare", { $ifNull: ["$nightSurcharge", 0] }, { $ifNull: ["$returnTripFare", 0] }, { $ifNull: ["$penaltyApplied", 0] }, { $ifNull: ["$tollFee", 0] }]
          }
        }
      },
      { $group: { _id: null, total: { $sum: "$effectiveTotal" } } }
    ]);
    const totalEarnings = totalEarningsAgg[0]?.total || 0;

    res.json({
      dashboard: {
        driver: {
          id: driver._id,
          name: driver.name,
          rating: Math.round(avgRatingDash * 10) / 10,
          available: driver.available,
          online: driver.online || false,
          isVerified: driver.isVerified || false,
          verificationNote: driver.verificationNote || "",
          vehicleType: driver.vehicleType,
          serviceType: driver.serviceType,
          profileImage: driver.profileImage || ""
        },
        stats: {
          todayTrips,
          todayEarnings,
          totalTrips,
          totalEarnings,
          pendingBookings,
          rating: Math.round(avgRatingDash * 10) / 10
        },
        currentBooking: currentBooking ? {
          id: currentBooking._id,
          pickupLocation: currentBooking.pickupLocation,
          dropLocation: currentBooking.dropLocation,
          status: currentBooking.status,
          user: currentBooking.user
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch dashboard",
      error: error.message
    });
  }
};

// ================= CHANGE PASSWORD =================
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required"
      });
    }

    const driver = await Driver.findById(req.driverId);

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, driver.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect"
      });
    }

    driver.password = await bcrypt.hash(newPassword, 10);
    await driver.save();

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

// ================= LOGOUT DRIVER =================
export const logoutDriver = async (req, res) => {
  try {
    // In a real app, you might want to blacklist the token
    // For now, we just return success
    // Make driver unavailable on logout
    await Driver.findByIdAndUpdate(req.driverId, { available: false });

    res.json({
      message: "Logout successful"
    });
  } catch (error) {
    res.status(500).json({
      message: "Logout failed",
      error: error.message
    });
  }
};

// ================= REQUEST PAYOUT =================
export const requestPayout = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: "Invalid payout amount"
      });
    }

    const driver = await Driver.findById(req.driverId);
    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    if (amount > (driver.totalEarnings || 0)) {
      return res.status(400).json({
        message: "Insufficient balance"
      });
    }

    const payout = await Payout.create({
      driver: req.driverId,
      amount,
      status: "pending"
    });

    res.status(201).json({
      message: "Payout request submitted successfully",
      payout
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to submit payout request",
      error: error.message
    });
  }
};

// ================= UPDATE PROFILE IMAGE =================
export const updateProfileImage = async (req, res) => {
  try {
    let { profileImage } = req.body;

    if (!profileImage) {
      return res.status(400).json({
        message: "Profile image is required"
      });
    }

    // If it's a base64 string, upload to ImageKit
    if (profileImage.startsWith('data:')) {
      const fileName = `profile_${req.driverId}_${Date.now()}.jpg`;
      const uploadResponse = await uploadToImageKit(profileImage, fileName, "/profile_images");
      profileImage = uploadResponse.url;
    }

    const driver = await Driver.findByIdAndUpdate(
      req.driverId,
      { profileImage },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    res.json({
      message: "Profile image updated successfully",
      profileImage: driver.profileImage
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update profile image",
      error: error.message
    });
  }
};

// ================= FORGOT PASSWORD =================
export const forgotPassword = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({
        message: "Mobile number is required"
      });
    }

    const driver = await Driver.findOne({ mobile });

    if (!driver) {
      return res.status(404).json({
        message: "Driver with this mobile number not found"
      });
    }

    // In a real app, generate a random OTP and send via SMS
    // For now, we'll use a mock OTP: 1234
    const otp = "1234";

    res.json({
      message: "OTP sent successfully (MOCK: 1234)",
      otp: otp // Returning OTP for demo purposes
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to send OTP",
      error: error.message
    });
  }
};

// ================= RESET PASSWORD =================
export const resetPassword = async (req, res) => {
  try {
    const { mobile, otp, newPassword } = req.body;

    if (!mobile || !otp || !newPassword) {
      return res.status(400).json({
        message: "Mobile, OTP and new password are required"
      });
    }

    // Verify OTP (mock verification)
    if (otp !== "1234") {
      return res.status(400).json({
        message: "Invalid OTP"
      });
    }

    const driver = await Driver.findOne({ mobile });

    if (!driver) {
      return res.status(404).json({
        message: "Driver not found"
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    driver.password = hashedPassword;
    await driver.save();

    res.json({
      message: "Password reset successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to reset password",
      error: error.message
    });
  }
};

// ================= CALCULATE AND UPDATE PENALTY =================
export const calculateAndUpdatePenalty = async (booking) => {
  if (!booking || !booking.waitingStartedAt) return;

  const now = new Date();
  const waitingTimeSeconds = Math.floor((now - new Date(booking.waitingStartedAt)) / 1000);
  const gracePeriodSeconds = booking.waitingLimit || 3600;

  if (waitingTimeSeconds > gracePeriodSeconds) {
    const excessSeconds = waitingTimeSeconds - gracePeriodSeconds;
    const penaltyMinutes = Math.floor(excessSeconds / 60);
    const penaltyRatePerMin = 2; // ₹2 per minute
    const newPenalty = penaltyMinutes * penaltyRatePerMin;

    if (newPenalty !== booking.penaltyApplied) {
      booking.penaltyApplied = newPenalty;
      // Recalculate total fare including penalty
      booking.totalFare = (booking.fare || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + (booking.tollFee || 0);
      await booking.save();

      // Emit update via socket
      try {
        const io = getIO();
        const rooms = [booking.user.toString(), booking.driver.toString()];
        rooms.forEach((room) => {
          io.to(room).emit("penaltyApplied", {
            bookingId: booking._id.toString(),
            penaltyApplied: booking.penaltyApplied,
            totalFare: booking.totalFare
          });
        });
        serverLog(`[Penalty] Applied ₹${newPenalty} to booking ${booking._id}`);
      } catch (socketError) {
        serverLog(`[Penalty] Socket error: ${socketError.message}`);
      }
      return true;
    }
  }
  return false;
};


