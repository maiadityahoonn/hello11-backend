import { clearUserCache } from "../middleware/cacheMiddleware.js";
import Booking from "../models/Booking.js";
import Driver from "../models/Driver.js";
import User from "../models/User.js";
import { getIO } from "../utils/socketLogic.js";
import { serverLog } from "../utils/logger.js";
import { createNotification } from "./notificationController.js";
import { sendPushNotification } from "../utils/notifications.js";
import { calcAllowedTime } from "./fareController.js";

// Keep this null in normal flow; only set a value for temporary testing overrides.
const TEST_WAITING_LIMIT_SECONDS = null;
const resolveWaitingLimitSeconds = (distanceKm = 0) =>
  TEST_WAITING_LIMIT_SECONDS ?? (calcAllowedTime(distanceKm) * 60);

const getOneWayFare = (booking) => {
  const fare = Number(booking?.fare || 0);
  const baseFare = Number(booking?.baseFare || 0);
  const nightSurcharge = Number(booking?.nightSurcharge || 0);

  // Legacy-bug guard: if baseFare was copied from fare and night exists, avoid double-count.
  if (baseFare > 0 && nightSurcharge > 0 && Math.abs(baseFare - fare) <= 1) {
    return fare;
  }

  if (baseFare > 0) return baseFare + nightSurcharge;
  return fare;
};

const getBookingTotalFare = (booking) =>
  getOneWayFare(booking) +
  Number(booking?.returnTripFare || 0) +
  Number(booking?.penaltyApplied || 0) +
  Number(booking?.tollFee || 0);

// ================= GET ACTIVE BOOKING (Persistence) =================
export const getActiveBooking = async (req, res) => {
  try {
    const now = new Date();
    const booking = await Booking.findOne({
      user: req.userId,
      status: { $in: ["accepted", "driver_assigned", "arrived", "started", "waiting", "return_ride_started"] },
      $or: [
        { bookingType: { $ne: "schedule" } },
        { scheduledDate: { $lte: now } }
      ]
    })
      .populate("user", "name mobile profileImage")
      .populate("driver", "name vehicleModel vehicleNumber rating profileImage mobile latitude longitude");

    if (!booking) {
      return res.json({ success: true, booking: null });
    }

    // Dynamic penalty calculation if waiting started
    if (booking.waitingStartedAt) {
      // Lazy import to avoid circular dependency if needed, though they usually coexist fine
      const { calculateAndUpdatePenalty } = await import("./driverController.js").catch(() => ({}));
      if (typeof calculateAndUpdatePenalty === 'function') {
        await calculateAndUpdatePenalty(booking);
      }
    }

    // Always expose computed trip total for consistency
    booking.totalFare = getBookingTotalFare(booking);

    res.json({
      success: true,
      booking
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch active booking", error: error.message });
  }
};

// ================= CREATE BOOKING =================
export const createBooking = async (req, res) => {
  try {
    const { pickupLocation, dropLocation, rideType, bookingType, scheduledDate } = req.body;

    if (!pickupLocation || !dropLocation) {
      return res.status(400).json({
        message: "Pickup and drop locations are required"
      });
    }

    // Prevent multiple active bookings
    const activeBooking = await Booking.findOne({
      user: req.userId,
      status: { $in: ["pending", "accepted", "driver_assigned", "arrived", "started"] }
    });

    if (activeBooking) {
      const isStale = (new Date() - new Date(activeBooking.createdAt)) > 30 * 60 * 1000; // 30 minutes

      if (activeBooking.status === 'pending' || (activeBooking.status === 'accepted' && isStale)) {
        // Auto-cancel stale pending or old accepted request
        activeBooking.status = 'cancelled';
        activeBooking.cancellationReason = 'Auto-cancelled for new search (Stale)';
        await activeBooking.save();
        serverLog(`[Auto-Cancel] Booking ${activeBooking._id} (${activeBooking.status}) cancelled for new request by user ${req.userId}`);
      } else {
        // Allow blocking ONLY if a driver is actively moving/trip started or recent accepted
        return res.status(400).json({
          message: `You already have an active ride (${activeBooking.status}). Please cancel it to book a new one.`,
          bookingId: activeBooking._id
        });
      }
    }

    const incomingFare = Number(req.body.fare || 0);
    const incomingNightSurcharge = Number(req.body.nightSurcharge || 0);
    const incomingBaseFare = Number(req.body.baseFare || 0);
    const normalizedBaseFare = incomingBaseFare > 0 ? incomingBaseFare : Math.max(0, incomingFare - incomingNightSurcharge);
    const normalizedOneWayFare = incomingFare > 0 ? incomingFare : normalizedBaseFare + incomingNightSurcharge;
    const normalizedTotalFare =
      Number(req.body.totalFare || 0) ||
      (normalizedOneWayFare + Number(req.body.returnTripFare || 0) + Number(req.body.tollFee || 0));

    const booking = await Booking.create({
      user: req.userId,
      pickupLocation,
      dropLocation,
      pickupLatitude: req.body.pickupLatitude || 0,
      pickupLongitude: req.body.pickupLongitude || 0,
      dropLatitude: req.body.dropLatitude || 0,
      dropLongitude: req.body.dropLongitude || 0,
      rideType: rideType || "normal",
      vehicleType: req.body.vehicleType || "5seater",
      bookingType: bookingType || "now",
      scheduledDate: bookingType === "schedule" ? scheduledDate : null,
      // Scheduled rides start as 'scheduled'; ride-now rides start as 'pending'
      status: bookingType === "schedule" ? "scheduled" : "pending",
      baseFare: normalizedBaseFare,
      distance: req.body.distance || 0,
      duration: req.body.duration || 0,
      nightSurcharge: incomingNightSurcharge,
      fare: normalizedOneWayFare,
      hasReturnTrip: req.body.hasReturnTrip || false,
      returnTripFare: req.body.returnTripFare || 0,
      totalFare: normalizedTotalFare,
      tollFee: req.body.tollFee || 0,
      waitingLimit: resolveWaitingLimitSeconds(req.body.distance || 0), // Store in seconds
    });


    // BROADCAST to nearby drivers — only for 'ride now' bookings
    if (bookingType !== "schedule") {
      const io = getIO();
      try {
        serverLog(`BROADCAST: Searching for drivers | RideType: ${booking.rideType} | Vehicle: ${booking.vehicleType}`);
        const maxDistanceMeters = booking.rideType === 'outstation' ? 20000 : 5000;
        const locationNear = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [booking.pickupLongitude, booking.pickupLatitude]
            },
            $maxDistance: maxDistanceMeters
          }
        };
        // `$near` cannot be used in `countDocuments`; use `$geoWithin` for debug counts.
        const radiusRadians = maxDistanceMeters / 6378137;
        const locationWithin = {
          $geoWithin: {
            $centerSphere: [[booking.pickupLongitude, booking.pickupLatitude], radiusRadians]
          }
        };

        // Dispatch debug telemetry to understand why a driver might not receive requests.
        const [nearbyOnlineCount, nearbyAvailableCount, nearbyVerifiedCount] = await Promise.all([
          Driver.countDocuments({
            online: true,
            location: locationWithin
          }),
          Driver.countDocuments({
            online: true,
            available: true,
            location: locationWithin
          }),
          Driver.countDocuments({
            online: true,
            available: true,
            isVerified: true,
            location: locationWithin
          }),
        ]);

        serverLog(
          `DISPATCH DEBUG: booking=${booking._id} | onlineNearby=${nearbyOnlineCount} | availableNearby=${nearbyAvailableCount} | verifiedNearby=${nearbyVerifiedCount}`
        );

        const query = {
          available: true,
          online: true,
          isVerified: true,
          location: locationNear
        };

        // For outstation, strictly match the selected vehicle type and service support
        if (booking.rideType === 'outstation') {
          query.vehicleType = booking.vehicleType;
          query.serviceType = { $in: ['rental', 'both'] };
        }

        const nearbyDrivers = await Driver.find(query);

        serverLog(`BROADCAST: Found ${nearbyDrivers.length} matching drivers for ${booking.rideType} trip`);

        nearbyDrivers.forEach(driver => {
          serverLog(`BROADCAST: Emitting 'newRideRequest' to room ${driver._id.toString()}`);
          io.to(driver._id.toString()).emit("newRideRequest", {
            bookingId: booking._id,
            pickup: pickupLocation,
            drop: dropLocation,
            fare: booking.fare,
            distance: booking.distance,
            rideType: booking.rideType,
            vehicleType: booking.vehicleType,
            bookingType: booking.bookingType
          });

          // Send Push Notification if token exists
          if (driver.pushToken) {
            sendPushNotification(
              driver.pushToken,
              "New Ride Request",
              `${booking.rideType === 'outstation' ? 'Outstation' : 'Local'} ride from ${pickupLocation} to ${dropLocation}. Fare: ₹${booking.fare}`,
              {
                bookingId: booking._id.toString(),
                type: 'new_ride'
              }
            );
          }
        });
      } catch (err) {
        serverLog(`BROADCAST ERROR: ${err.message}`);
      }
    } else {
      // For scheduled rides, notify nearby drivers immediately so interested drivers can pre-accept.
      try {
        const io = getIO();
        const maxDistanceMeters = booking.rideType === "outstation" ? 50000 : 20000;

        const query = {
          available: true,
          online: true,
          isVerified: true,
          location: {
            $near: {
              $geometry: {
                type: "Point",
                coordinates: [booking.pickupLongitude, booking.pickupLatitude]
              },
              $maxDistance: maxDistanceMeters
            }
          }
        };

        if (booking.rideType === "outstation") {
          query.vehicleType = booking.vehicleType;
          query.serviceType = { $in: ["rental", "both"] };
        }

        const nearbyDrivers = await Driver.find(query);
        serverLog(`SCHEDULED: Notifying ${nearbyDrivers.length} nearby drivers immediately for booking ${booking._id}`);

        nearbyDrivers.forEach((driver) => {
          io.to(driver._id.toString()).emit("newRideRequest", {
            bookingId: booking._id,
            pickup: pickupLocation,
            drop: dropLocation,
            fare: booking.fare,
            distance: booking.distance,
            rideType: booking.rideType,
            vehicleType: booking.vehicleType,
            bookingType: "schedule",
            scheduledDate: booking.scheduledDate
          });

          if (driver.pushToken) {
            sendPushNotification(
              driver.pushToken,
              "Scheduled Ride Request",
              `${booking.rideType === "outstation" ? "Outstation" : "Local"} scheduled ride at ${new Date(booking.scheduledDate).toLocaleString("en-IN")}.`,
              {
                bookingId: booking._id.toString(),
                type: "new_ride",
                bookingType: "schedule",
                scheduledDate: booking.scheduledDate
              }
            );
          }
        });
      } catch (err) {
        serverLog(`SCHEDULED BROADCAST ERROR: ${err.message}`);
      }
    }

    if (req.userId) await clearUserCache(req.userId, 'user');
    res.status(201).json({
      message: "Booking created successfully",
      booking: {
        id: booking._id,
        pickupLocation: booking.pickupLocation,
        dropLocation: booking.dropLocation,
        rideType: booking.rideType,
        bookingType: booking.bookingType,
        status: booking.status,
        otp: booking.otp,
        fare: booking.fare,
        discount: booking.discount,
        vehicleType: booking.vehicleType,
        scheduledDate: booking.scheduledDate
      }
    });
  } catch (error) {
    serverLog(`CREATE BOOKING ERROR: ${error.message}`);
    console.error("Booking Creation Error:", error);
    res.status(500).json({
      message: "Failed to create booking",
      error: error.message
    });
  }
};

// ================= GET USER BOOKINGS =================
export const getUserBookings = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { bookingType, status, rideType, paymentStatus, startDate, endDate } = req.query;

    console.log('[getUserBookings] Input params:', { bookingType, status, rideType, paymentStatus });

    // Build filter query
    const query = { user: req.userId };

    // Handle bookingType filtering with automatic status filtering
    if (bookingType === "schedule") {
      query.bookingType = "schedule";
      query.status = "scheduled";  // Scheduled rides must have status "scheduled"
    } else if (bookingType === "now") {
      query.bookingType = "now";
      // For "now" rides, exclude the "scheduled" status - show only completed, cancelled, accepted, etc.
      query.status = { $ne: "scheduled" };
    } else if (bookingType) {
      query.bookingType = bookingType;
    }

    // Override with explicit status if provided in query
    if (status) {
      query.status = status;
    }

    // IMPORTANT: rideType filter - apply only if not empty string
    if (rideType && rideType !== "all") {
      console.log('[getUserBookings] Filtering by rideType:', rideType);
      query.rideType = rideType;
    } else {
      console.log('[getUserBookings] No rideType filter (all rides selected)');
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    console.log('[getUserBookings] Final query filter:', JSON.stringify(query));

    // Parallelize count and data fetch for speed
    // Sort by scheduledDate for scheduled rides, createdAt for now rides
    const sortOrder = bookingType === "schedule" ? { scheduledDate: 1 } : { createdAt: -1 };

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .select('pickupLocation dropLocation fare status rideType paymentStatus createdAt distance driver rating vehicleType totalFare scheduledDate bookingType')
        .sort(sortOrder)
        .skip(skip)
        .limit(limit)
        .lean(),
      Booking.countDocuments(query)
    ]);

    console.log(`[getUserBookings] Found ${bookings.length} bookings. Ride types:`, bookings.map(b => b.rideType));

    res.json({
      success: true,
      bookings,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch bookings",
      error: error.message
    });
  }
};

// ================= GET SCHEDULED BOOKINGS =================
export const getScheduledBookings = async (req, res) => {
  try {
    console.log('[getScheduledBookings] userId:', req.userId);
    const bookings = await Booking.find({
      user: req.userId,
      status: "scheduled"
      // No date filter — show all scheduled regardless of time
    })
      .select('pickupLocation dropLocation fare status rideType vehicleType scheduledDate distance')
      .sort({ scheduledDate: 1 })
      .lean();

    console.log('[getScheduledBookings] found:', bookings.length);
    res.json({ success: true, bookings });
  } catch (error) {
    console.error('[getScheduledBookings] error:', error.message);
    res.status(500).json({
      message: "Failed to fetch scheduled bookings",
      error: error.message
    });
  }
};

// ================= GET SCHEDULED RIDE HISTORY =================
export const getScheduledHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { status, rideType, paymentStatus, startDate, endDate } = req.query;

    const query = {
      user: req.userId,
      bookingType: "schedule",
      status: { $nin: ["scheduled"] }
    };

    // Add optional filters
    if (status && status !== "all") {
      query.status = status;
    }
    if (rideType && rideType !== "all") {
      query.rideType = rideType;
    }
    if (paymentStatus && paymentStatus !== "all") {
      query.paymentStatus = paymentStatus;
    }
    if (startDate || endDate) {
      query.scheduledDate = {};
      if (startDate) query.scheduledDate.$gte = new Date(startDate);
      if (endDate) query.scheduledDate.$lte = new Date(endDate);
    }

    // Parallelize for speed
    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .select('pickupLocation dropLocation fare status rideType paymentStatus scheduledDate createdAt distance driver rating vehicleType totalFare')
        .sort({ scheduledDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Booking.countDocuments(query)
    ]);

    res.json({ success: true, bookings, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch scheduled ride history",
      error: error.message
    });
  }
};

// ================= GET BOOKING BY ID =================
export const getBookingById = async (req, res) => {
  try {
    const compact = req.query.compact === "1";
    let query = Booking.findById(req.params.id);

    if (!compact) {
      query = query
        .populate("user", "name mobile profileImage")
        .populate("driver", "name mobile vehicleModel vehicleNumber rating vehicleType profileImage latitude longitude location");
    }

    const booking = await query;

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    // Check authorization: must be either the user or the driver
    const authId = (req.userId || req.driverId || "").toString();
    const bookingUserId = (booking.user?._id || booking.user || "").toString();
    const bookingDriverId = (booking.driver?._id || booking.driver || "").toString();
    const isUser = bookingUserId === authId;
    const isDriver = bookingDriverId && bookingDriverId === authId;

    if (!isUser && !isDriver) {
      return res.status(403).json({
        message: "Not authorized to view this booking"
      });
    }

    // Always expose computed trip total for consistency in history/details
    booking.totalFare = getBookingTotalFare(booking);

    res.json({
      booking
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch booking",
      error: error.message
    });
  }
};

// ================= CANCEL BOOKING =================
export const cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (booking.user.toString() !== req.userId) {
      return res.status(403).json({
        message: "Not authorized to cancel this booking"
      });
    }

    if (booking.status === "cancelled") {
      return res.json({
        message: "Booking is already cancelled",
        booking
      });
    }

    if (booking.status === "completed") {
      return res.status(400).json({
        message: "Cannot cancel a completed booking"
      });
    }

    // Safety guard: prevent cancellation once trip has started/waiting phase.
    if (["started", "waiting", "return_ride_started"].includes(String(booking.status))) {
      return res.status(400).json({
        message: "Ride has already started. Cancellation is not allowed at this stage."
      });
    }

    const previousStatus = booking.status;
    booking.status = "cancelled";
    booking.cancelledBy = "user";
    await booking.save();
    serverLog(
      `[Cancel][User] booking=${booking._id} user=${req.userId} previousStatus=${previousStatus} newStatus=${booking.status}`
    );

    // Notify both user and driver
    try {
      const io = getIO();

      // Notify User (to sync across devices/sessions)
      io.to(booking.user.toString()).emit("bookingCancelledByUser", {
        bookingId: booking._id.toString(),
        message: "Booking cancelled successfully"
      });

      // Notify Driver (if assigned)
      if (booking.driver) {
        await Driver.findByIdAndUpdate(booking.driver, {
          available: true,
          currentBooking: null
        });
        io.to(booking.driver.toString()).emit("bookingCancelledByUser", {
          bookingId: booking._id.toString(),
          message: "The user has cancelled this ride."
        });
      } else {
        // If NO driver was assigned, it means the ride was still in "Searching" or "Scheduled" state
        // and was broadcast to multiple drivers. We must tell them all to HIDE the request.
        io.emit("rideRequestCancelled", {
          bookingId: booking._id.toString()
        });
      }

      // Create persistent notification for user (confirmation of their cancellation)
      await createNotification({
        userId: booking.user,
        title: "Ride Cancelled",
        body: "You have successfully cancelled your ride booking.",
        type: "ride_cancelled",
        bookingId: booking._id
      });
    } catch (socketError) {
      serverLog(`Socket notification error: ${socketError.message}`);
    }

    res.json({
      message: "Booking cancelled successfully",
      booking
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to cancel booking",
      error: error.message
    });
  }
};

// ================= GET BOOKING STATUS =================
export const getBookingStatus = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate("user", "name mobile profileImage")
      .populate("driver", "name vehicleModel vehicleNumber rating profileImage mobile latitude longitude");

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Dynamic penalty calculation if waiting started
    if (booking.waitingStartedAt) {
      const { calculateAndUpdatePenalty } = await import("./driverController.js").catch(() => ({}));
      if (typeof calculateAndUpdatePenalty === 'function') {
        await calculateAndUpdatePenalty(booking);
      }
    }

    // Always expose computed trip total for consistency in tracking/details
    booking.totalFare = getBookingTotalFare(booking);

    res.json({
      success: true,
      booking
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch booking status", error: error.message });
  }
};

// ================= START RIDE (OTP VERIFICATION) =================
export const startRide = async (req, res) => {
  try {
    const { otp } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (booking.otp !== otp) {
      return res.status(400).json({
        message: "Invalid OTP"
      });
    }

    booking.status = "started";
    await booking.save();

    res.json({
      message: "Ride started successfully",
      booking: {
        id: booking._id,
        status: booking.status
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to start ride",
      error: error.message
    });
  }
};

// ================= COMPLETE RIDE =================
export const completeRide = async (req, res) => {
  try {
    const { fare, distance } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (booking) await clearUserCache(booking.user, 'user');

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    booking.status = "completed";
    // Important: Keep original booking.fare if it exists
    if (!booking.fare || booking.fare === 0) {
      booking.fare = fare || 0;
    }
    booking.distance = distance || booking.distance || 0;
    booking.paymentStatus = booking.paymentStatus === "paid" ? "paid" : "pending";
    booking.rideCompletedAt = new Date();

    // Always store full trip total (base + return + penalty)
    booking.totalFare = getBookingTotalFare(booking);

    await booking.save();

    // Notify User
    getIO().to(booking.user.toString()).emit("rideCompleted", {
      bookingId: booking._id,
      status: "completed",
      finalFare: booking.totalFare
    });

    // Clear driver status
    if (booking.driver) {
      await Driver.findByIdAndUpdate(booking.driver, {
        available: true,
        online: true // Ensure they stay online for next ride
      });
    }

    // Send Push Notification to User
    const user = await User.findById(booking.user);
    if (user && user.pushToken) {
      sendPushNotification(
        user.pushToken,
        "Ride Completed",
        `Your ride has been completed. Total fare: ₹${booking.totalFare}. Thank you for riding with Hello-11!`,
        { bookingId: booking._id.toString(), type: 'ride_completed' }
      );
    }

    res.json({
      success: true,
      message: "Ride completed successfully",
      fare: booking.totalFare,
      distance: booking.distance
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to complete ride",
      error: error.message
    });
  }
};

// ================= VERIFY PAYMENT =================
export const verifyPayment = async (req, res) => {
  try {
    const { paymentMethod, isFirstLeg } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    if (isFirstLeg) {
      booking.firstLegPaid = true;
      serverLog(`Intermediate payment (Leg 1) verified for booking ${booking._id}`);
    } else {
      booking.paymentStatus = "paid";
      serverLog(`Final payment verified for booking ${booking._id}`);
    }

    booking.paymentMethod = paymentMethod || "cash";
    await booking.save();

    // Close active payment prompt on passenger app
    try {
      const io = getIO();
      const userRoom = booking.user.toString();
      const bookingRoom = `chat_${booking._id}`;
      [userRoom, bookingRoom].forEach(room => {
        io.to(room).emit("paymentResolved", {
          bookingId: booking._id.toString(),
          isFirstLeg: !!isFirstLeg,
          paymentStatus: booking.paymentStatus || "pending",
          firstLegPaid: !!booking.firstLegPaid
        });
      });
    } catch (socketError) {
      serverLog(`paymentResolved socket error: ${socketError.message}`);
    }

    res.json({
      message: isFirstLeg ? "First leg payment verified successfully" : "Payment verified successfully",
      booking: {
        id: booking._id,
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod,
        firstLegPaid: booking.firstLegPaid
      }
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to verify payment",
      error: error.message
    });
  }
};

// ================= UPDATE PAYMENT CHOICE =================
export const updatePaymentChoice = async (req, res) => {
  try {
    const { paymentChoice } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!["leg_by_leg", "total_at_end"].includes(paymentChoice)) {
      return res.status(400).json({ message: "Invalid payment choice" });
    }

    booking.paymentChoice = paymentChoice;

    // If user chooses total_at_end for an outstation trip, we can proceed to waiting
    if (paymentChoice === "total_at_end" && booking.rideType === "outstation") {
      booking.status = "waiting";
      booking.isWaiting = true;
      booking.waitingStartedAt = new Date();
    }

    await booking.save();

    res.json({
      success: true,
      message: `Payment choice updated to ${paymentChoice}`,
      booking: {
        id: booking._id,
        paymentChoice: booking.paymentChoice,
        status: booking.status
      }
    });

    // Notify user via socket
    try {
      const io = getIO();
      if (booking.user) {
        io.to(booking.user.toString()).emit("rideStatusUpdate", {
          bookingId: booking._id.toString(),
          status: booking.status,
          message: `Payment choice updated: ${paymentChoice}`
        });
      }
    } catch (err) { }

  } catch (error) {
    res.status(500).json({ message: "Failed to update payment choice", error: error.message });
  }
};

// ================= REQUEST PAYMENT =================
export const requestPayment = async (req, res) => {
  try {
    const { amount, isPartial, breakdown } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const parsedAmount = Number(amount);
    const baseFare = Number(breakdown?.baseFare || 0);
    const returnFare = Number(breakdown?.returnFare || 0);
    const penalty = Number(breakdown?.penalty || 0);
    const toll = Number(breakdown?.toll || 0);
    const nightSurcharge = Number(breakdown?.nightSurcharge || 0);
    const firstLegPaid = !!breakdown?.firstLegPaid;

    // Guard against undefined/invalid amount reaching passenger UI.
    const safeAmount = Number.isFinite(parsedAmount)
      ? parsedAmount
      : (isPartial
        ? baseFare
        : (firstLegPaid ? (returnFare + penalty + toll) : (baseFare + returnFare + penalty + toll)));

    // Emit to passenger (User room and Booking room)
    const io = getIO();
    const userRoom = booking.user.toString();
    const bookingRoom = `chat_${booking._id}`;

    [userRoom, bookingRoom].forEach(room => {
      io.to(room).emit("paymentRequested", {
        bookingId: booking._id,
        amount: safeAmount,
        isPartial,
        breakdown: {
          baseFare,
          returnFare,
          penalty,
          toll,
          nightSurcharge,
          firstLegPaid
        }
      });
    });

    res.json({
      success: true,
      message: "Payment request sent to terminal"
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to request payment",
      error: error.message
    });
  }
};

// ================= ACCEPT RETURN OFFER =================
export const acceptReturnOffer = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Security: Only the user who made the booking can accept the offer
    if (booking.user.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized to accept this offer" });
    }

    if (booking.hasReturnTrip) {
      return res.json({
        message: "Return trip offer already accepted",
        returnTripFare: booking.returnTripFare
      });
    }

    // Logic: 50% OFF on return trip
    const returnFare = Math.round(booking.fare * 0.5);

    booking.hasReturnTrip = true;
    booking.returnTripFare = returnFare;
    booking.discount = 50; // 50% off

    // Update totalFare
    booking.totalFare = (booking.fare || 0) + returnFare + (booking.penaltyApplied || 0) + (booking.tollFee || 0);

    await booking.save();

    const io = getIO();
    io.to(booking.user.toString()).emit("returnTripAccepted", {
      bookingId: booking._id,
      returnTripFare: returnFare
    });
    if (booking.driver) {
      io.to(booking.driver.toString()).emit("returnTripAccepted", {
        bookingId: booking._id,
        returnTripFare: returnFare
      });

      // Create persistent notification for driver
      await createNotification({
        userId: booking.driver,
        title: "Return Trip Confirmed",
        body: `The user has accepted the return trip offer for ₹${returnFare}.`,
        type: "ride_accepted",
        bookingId: booking._id
      });
    }

    // Create persistent notification for user
    await createNotification({
      userId: booking.user,
      title: "Return Trip Offer Accepted",
      body: `Your return trip at 50% OFF (₹${returnFare}) has been confirmed.`,
      type: "ride_accepted",
      bookingId: booking._id
    });

    res.json({
      message: "Return trip offer accepted",
      returnTripFare: returnFare
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to accept return offer", error: error.message });
  }
};

// ================= CONFIRM RETURN RIDE START =================
export const confirmReturnRideStart = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.user.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized to confirm return start" });
    }

    if (booking.status === "return_ride_started") {
      return res.json({ message: "Return ride already started", booking: { id: booking._id, status: booking.status } });
    }

    if (booking.status !== "waiting") {
      return res.status(400).json({ message: "Return ride can only be started from waiting state" });
    }

    if (!booking.returnStartRequested) {
      return res.status(400).json({ message: "No pending return start request from driver" });
    }

    if (!booking.hasReturnTrip && Number(booking.returnTripFare || 0) <= 0) {
      return res.status(400).json({ message: "No return trip is active for this booking" });
    }

    booking.status = "return_ride_started";
    booking.returnStartRequested = false;
    booking.returnStartRequestedAt = null;
    booking.isWaiting = false;
    await booking.save();

    const io = getIO();
    const payload = {
      bookingId: booking._id.toString(),
      status: "return_ride_started",
      message: "Return ride started after user confirmation"
    };
    io.to(booking.user.toString()).emit("rideStatusUpdate", payload);
    if (booking.driver) {
      io.to(booking.driver.toString()).emit("rideStatusUpdate", payload);
      io.to(booking.driver.toString()).emit("returnRideStartConfirmed", {
        bookingId: booking._id.toString(),
        message: "User confirmed. Return ride started."
      });
    }

    return res.json({
      message: "Return ride started successfully",
      booking: {
        id: booking._id,
        status: booking.status
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to confirm return ride start", error: error.message });
  }
};

// ================= START WAITING =================
export const startWaiting = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Security: Only the assigned driver can start the waiting timer
    const authId = (req.driverId || req.userId || "").toString();

    if (!booking.driver || booking.driver.toString() !== authId) {
      return res.status(403).json({ message: "Not authorized to start waiting" });
    }

    // Validation
    if (booking.status !== "started") {
      return res.status(400).json({ message: "Ride must be in progress to start waiting" });
    }

    if (!booking.hasReturnTrip) {
      return res.status(400).json({ message: "No return trip offer active for this booking" });
    }

    // Logic: Split payment check
    if (booking.rideType === "normal" && !booking.firstLegPaid) {
      return res.status(400).json({
        message: "Payment for the first leg is required before starting the waiting timer for normal trips.",
        requiresPayment: true
      });
    }

    if (booking.rideType === "outstation" && booking.paymentChoice === "leg_by_leg" && !booking.firstLegPaid) {
      return res.status(400).json({
        message: "Confirmation required: Collect payment or choose 'Total at end' for outstation return.",
        requiresChoice: true
      });
    }

    booking.status = "waiting";
    booking.isWaiting = true;
    booking.returnStartRequested = false;
    booking.returnStartRequestedAt = null;
    if (TEST_WAITING_LIMIT_SECONDS) {
      booking.waitingLimit = TEST_WAITING_LIMIT_SECONDS;
    } else if (!booking.waitingLimit || booking.waitingLimit <= 0) {
      booking.waitingLimit = resolveWaitingLimitSeconds(booking.distance || 0);
    }
    booking.waitingStartedAt = new Date();

    await booking.save();

    const io = getIO();
    const userRoom = booking.user.toString();

    io.to(userRoom).emit("rideStatusUpdate", {
      bookingId: booking._id.toString(),
      status: "waiting",
      message: "Driver has reached destination and is now waiting for your return."
    });

    io.to(userRoom).emit("waitingStarted", {
      bookingId: booking._id,
      waitingStartedAt: booking.waitingStartedAt,
      waitingLimit: booking.waitingLimit
    });

    res.json({
      message: "Waiting timer started",
      waitingStartedAt: booking.waitingStartedAt,
      waitingLimit: booking.waitingLimit
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to start waiting", error: error.message });
  }
};
