import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver"
    },
    pickupLocation: {
      type: String,
      required: true
    },
    pickupLatitude: {
      type: Number,
      default: 0
    },
    pickupLongitude: {
      type: Number,
      default: 0
    },
    dropLocation: {
      type: String,
      required: true
    },
    dropLatitude: {
      type: Number,
      default: 0
    },
    dropLongitude: {
      type: Number,
      default: 0
    },
    rideType: {
      type: String,
      enum: ["normal", "outstation"],
      default: "normal"
    },
    vehicleType: {
      type: String,
      enum: ["5seater", "7seater"],
      default: "5seater"
    },
    bookingType: {
      type: String,
      enum: ["now", "schedule"],
      default: "now"
    },
    scheduledDate: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ["pending", "scheduled", "accepted", "driver_assigned", "arrived", "started", "waiting", "return_ride_started", "completed", "cancelled"],
      default: "pending"
    },
    otp: {
      type: String,
      default: () => Math.floor(1000 + Math.random() * 9000).toString()
    },
    fare: {
      type: Number,
      default: 0
    },
    nightSurcharge: {
      type: Number,
      default: 0
    },
    distance: {
      type: Number,
      default: 0
    },
    duration: {
      type: Number,
      default: 0
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending"
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "upi", "wallet"],
      default: "cash"
    },
    cancellationReason: {
      type: String,
      default: ""
    },
    cancelledBy: {
      type: String,
      enum: ["user", "driver", "system"]
    },
    driverArrivedAt: {
      type: Date,
      default: null
    },
    rideStartedAt: {
      type: Date,
      default: null
    },
    rideCompletedAt: {
      type: Date,
      default: null
    },
    waitingTime: {
      type: Number,
      default: 0
    },
    waitingLimit: {
      type: Number,
      default: 3600 // 1 hour in seconds
    },
    waitingStartedAt: {
      type: Date,
      default: null
    },
    isWaiting: {
      type: Boolean,
      default: false
    },
    penaltyApplied: {
      type: Number,
      default: 0
    },
    tollFee: {
      type: Number,
      default: 0
    },
    lastPenaltyAppliedAt: {
      type: Date,
      default: null
    },
    baseFare: {
      type: Number,
      default: 0
    },
    distanceFare: {
      type: Number,
      default: 0
    },
    timeFare: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    surgeFare: {
      type: Number,
      default: 0
    },
    hasReturnTrip: {
      type: Boolean,
      default: false
    },
    returnTripFare: {
      type: Number,
      default: 0
    },
    rating: {
      type: Number,
      default: 0
    },
    feedback: {
      type: String,
      default: ""
    },
    nearbyNotificationSent: {
      type: Boolean,
      default: false
    },
    rideTimeReminderSent: {
      type: Boolean,
      default: false
    },
    returnStartRequested: {
      type: Boolean,
      default: false
    },
    returnStartRequestedAt: {
      type: Date,
      default: null
    },
    scheduledDispatchAttempts: {
      type: Number,
      default: 0
    },
    lastScheduledDispatchAt: {
      type: Date,
      default: null
    },
    totalFare: {
      type: Number,
      default: 0
    },
    firstLegPaid: {
      type: Boolean,
      default: false
    },
    paymentChoice: {
      type: String,
      enum: ["leg_by_leg", "total_at_end"],
      default: "leg_by_leg"
    },
    adminCommission: {
      type: Number,
      default: 0
    },
    driverEarnings: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// Indexes for faster history and status lookups
// Single field indexes
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ driver: 1, createdAt: -1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ paymentStatus: 1 });
bookingSchema.index({ rideType: 1 });
bookingSchema.index({ bookingType: 1 });
bookingSchema.index({ scheduledDate: 1 });

// Compound indexes for optimized queries
// For scheduled history filtering (most common)
bookingSchema.index({ user: 1, bookingType: 1, status: 1, scheduledDate: -1 });
// For now/instant booking history
bookingSchema.index({ user: 1, bookingType: 1, createdAt: -1, status: 1 });
// For filtering by ride type within history
bookingSchema.index({ user: 1, rideType: 1, createdAt: -1 });
// For payment status filtering
bookingSchema.index({ user: 1, paymentStatus: 1, createdAt: -1 });
// For date range queries
// bookingSchema.index({ user: 1, createdAt: -1 }); // Duplicate of line 199

bookingSchema.pre('validate', function() {
  if (this.vehicleType) {
    const vType = this.vehicleType.toLowerCase();
    // Map legacy values to new ones
    if (vType === 'sedan' || vType === '5-seater' || vType === 'any' || vType === 'mini') {
      this.vehicleType = '5seater';
    } else if (vType === '7-seater' || vType === 'suv') {
      this.vehicleType = '7seater';
    } else if (vType !== '5seater' && vType !== '7seater') {
      // Catch-all for any other legacy value
      this.vehicleType = '5seater';
    }
  }
});

export default mongoose.model("Booking", bookingSchema);
