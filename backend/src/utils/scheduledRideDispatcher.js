import cron from "node-cron";
import Booking from "../models/Booking.js";
import Driver from "../models/Driver.js";
import { getIO } from "./socketLogic.js";
import { serverLog } from "./logger.js";

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
        } catch (err) {
            serverLog(`SCHEDULER: Cron error: ${err.message}`);
        }
    });

    serverLog("SCHEDULER: Dispatcher running ✅");
};
