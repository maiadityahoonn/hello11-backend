import cron from "node-cron";
import Booking from "../models/Booking.js";
import Driver from "../models/Driver.js";
import { getIO } from "./socketLogic.js";
import { serverLog } from "./logger.js";
import { sendPushNotification } from "./notifications.js";

const ACTIVE_RIDE_STATUSES = ["accepted", "driver_assigned", "arrived", "started", "waiting", "return_ride_started"];

/**
 * Dispatch a single scheduled booking to nearby drivers.
 * Changes status pending → broadcasts newRideRequest to nearby drivers.
 */
const dispatchBooking = async (booking) => {
    const io = getIO();

    serverLog(`SCHEDULER: Dispatching scheduled booking ${booking._id} to nearby drivers`);

    try {
        // Base query: available + online + nearby pickup
        const driverQuery = {
            available: true,
            online: true,
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [booking.pickupLongitude, booking.pickupLatitude]
                    },
                    // Keep wider radius for scheduled rides to improve match chances
                    $maxDistance: 50000
                }
            }
        };

        // For outstation scheduled rides, send only to relevant drivers.
        // Normal scheduled rides continue to go to all nearby available drivers.
        if (booking.rideType === "outstation") {
            driverQuery.vehicleType = booking.vehicleType;
            driverQuery.serviceType = { $in: ["rental", "both"] };
        }

        const nearbyDrivers = await Driver.find(driverQuery);

        serverLog(`SCHEDULER: Found ${nearbyDrivers.length} nearby drivers for booking ${booking._id}`);

        // Update booking status to pending so drivers can accept
        booking.status = "pending";
        await booking.save();

        if (nearbyDrivers.length === 0) {
            serverLog(`SCHEDULER: No drivers available for booking ${booking._id}. Booking remains pending.`);
            return;
        }

        // Emit ride request to each nearby driver
        nearbyDrivers.forEach(driver => {
            io.to(driver._id.toString()).emit("newRideRequest", {
                bookingId: booking._id,
                pickup: booking.pickupLocation,
                drop: booking.dropLocation,
                fare: booking.fare,
                distance: booking.distance,
                rideType: booking.rideType,
                bookingType: "schedule",         // Lets driver know it's a scheduled ride
                scheduledDate: booking.scheduledDate
            });

            if (driver.pushToken) {
                sendPushNotification(
                    driver.pushToken,
                    "Scheduled Ride Is Live",
                    `Scheduled ride from ${booking.pickupLocation} to ${booking.dropLocation} is now ready to accept.`,
                    {
                        bookingId: booking._id.toString(),
                        type: "new_ride",
                        bookingType: "schedule",
                        scheduledDate: booking.scheduledDate
                    }
                );
            }
            serverLog(`SCHEDULER: Emitted newRideRequest to driver ${driver._id}`);
        });

        // Also notify the user that their scheduled ride is now being searched
        if (booking.user) {
            io.to(booking.user.toString()).emit("rideStatusUpdate", {
                bookingId: booking._id,
                status: "pending",
                message: "Your scheduled ride is now searching for a driver."
            });
        }
    } catch (err) {
        serverLog(`SCHEDULER: Error dispatching booking ${booking._id}: ${err.message}`);
    }
};

/**
 * Start the scheduled ride dispatcher.
 * Runs every minute. Looks for bookings scheduled within the next 30 minutes
 * that haven't been dispatched yet (status = "scheduled").
 */
export const startScheduledRideDispatcher = () => {
    serverLog("SCHEDULER: Starting scheduled ride dispatcher (runs every minute)");

    // Run every minute: * * * * *
    cron.schedule("* * * * *", async () => {
        try {
            const now = new Date();
            // Dispatch rides whose scheduledDate is within the current minute window
            // i.e., between [now - 30s] and [now + 90s] to handle any slight delay
            const windowStart = new Date(now.getTime() - 30 * 1000);   // 30s ago
            const windowEnd = new Date(now.getTime() + 90 * 1000);   // 90s ahead

            // Find all scheduled bookings whose ride time falls in this window
            const dueSoon = await Booking.find({
                status: "scheduled",
                scheduledDate: {
                    $gte: windowStart,
                    $lte: windowEnd
                }
            }).populate("user", "_id");

            if (dueSoon.length > 0) {
                serverLog(`SCHEDULER: Found ${dueSoon.length} scheduled ride(s) due NOW`);
                for (const booking of dueSoon) {
                    await dispatchBooking(booking);
                }
            }

            // Send reminder to the assigned driver right around scheduled time.
            const reminderBookings = await Booking.find({
                bookingType: "schedule",
                status: { $in: ["accepted", "driver_assigned"] },
                driver: { $ne: null },
                rideTimeReminderSent: { $ne: true },
                scheduledDate: {
                    $gte: windowStart,
                    $lte: windowEnd
                }
            }).populate("driver", "_id pushToken currentBooking");

            for (const booking of reminderBookings) {
                const driverId = booking.driver?._id?.toString?.();
                if (!driverId) continue;

                // Conflict handling: if this driver is already busy on another active ride, reassign this scheduled booking.
                const activeOtherRide = await Booking.findOne({
                    driver: driverId,
                    _id: { $ne: booking._id },
                    status: { $in: ACTIVE_RIDE_STATUSES }
                }).select("_id status");

                if (activeOtherRide) {
                    serverLog(
                        `SCHEDULER: Driver ${driverId} busy on booking ${activeOtherRide._id}. Reassigning scheduled booking ${booking._id}`
                    );

                    booking.driver = null;
                    booking.status = "pending";
                    booking.rideTimeReminderSent = false;
                    await booking.save();

                    io.to(driverId).emit("rideRequestCancelled", {
                        bookingId: booking._id.toString(),
                        reason: "Reassigned due to driver busy on another trip"
                    });

                    if (booking.user) {
                        io.to(booking.user.toString()).emit("rideStatusUpdate", {
                            bookingId: booking._id.toString(),
                            status: "pending",
                            message: "Assigned driver busy tha. Hum naya driver dhoondh rahe hain."
                        });
                    }

                    await dispatchBooking(booking);
                    continue;
                }

                io.to(driverId).emit("scheduledRideReminder", {
                    bookingId: booking._id.toString(),
                    pickup: booking.pickupLocation,
                    drop: booking.dropLocation,
                    scheduledDate: booking.scheduledDate,
                    message: "Scheduled ride time has started. Please go to pickup location."
                });

                if (booking.driver.pushToken) {
                    sendPushNotification(
                        booking.driver.pushToken,
                        "Scheduled Ride Reminder",
                        "Your scheduled ride time has started. Please move to pickup now.",
                        {
                            bookingId: booking._id.toString(),
                            type: "scheduled_ride_reminder",
                            scheduledDate: booking.scheduledDate
                        }
                    );
                }

                // Lock driver onto this scheduled booking at ride-time if driver is free.
                const driverDoc = await Driver.findById(driverId).select("currentBooking available");
                if (driverDoc) {
                    let canAttachScheduledRide = true;

                    if (driverDoc.currentBooking) {
                        const existing = await Booking.findById(driverDoc.currentBooking).select("status");
                        if (existing && !["completed", "cancelled"].includes(existing.status) && String(existing._id) !== String(booking._id)) {
                            canAttachScheduledRide = false;
                        }
                    }

                    if (canAttachScheduledRide) {
                        driverDoc.currentBooking = booking._id;
                        driverDoc.available = false;
                        await driverDoc.save();
                    }
                }

                booking.rideTimeReminderSent = true;
                await booking.save();
                serverLog(`SCHEDULER: Sent ride-time reminder to driver ${driverId} for booking ${booking._id}`);
            }

            // Safety net: keep retrying overdue scheduled bookings that are still unassigned.
            const overduePending = await Booking.find({
                bookingType: "schedule",
                status: "pending",
                driver: null,
                scheduledDate: { $lte: now }
            }).limit(20);

            for (const booking of overduePending) {
                await dispatchBooking(booking);
            }
        } catch (err) {
            serverLog(`SCHEDULER: Cron error: ${err.message}`);
        }
    });

    serverLog("SCHEDULER: Dispatcher running ✅");
};
