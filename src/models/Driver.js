import mongoose from "mongoose";

const driverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    mobile: {
      type: String,
      required: true,
      unique: true
    },
    password: {
      type: String,
      required: true
    },
    vehicleNumber: {
      type: String,
      required: true
    },
    vehicleModel: {
      type: String,
      required: true
    },
    vehicleColor: {
      type: String,
      default: ""
    },
    vehicleType: {
      type: String,
      enum: ["5seater", "7seater"],
      default: "5seater"
    },
    serviceType: {
      type: String,
      enum: ["cab", "rental", "both"],
      default: "cab"
    },
    licenseNumber: {
      type: String,
      default: ""
    },
    rating: {
      type: Number,
      default: 0
    },
    experienceYears: {
      type: Number,
      default: 0
    },
    totalRatings: {
      type: Number,
      default: 0
    },
    available: {
      type: Boolean,
      default: true
    },
    online: {
      type: Boolean,
      default: false
    },
    onlineTime: {
      type: Number,
      default: 0 // In minutes
    },
    lastOnlineToggle: {
      type: Date,
      default: null
    },
    latitude: {
      type: Number,
      default: 0
    },
    longitude: {
      type: Number,
      default: 0
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: {
        type: [Number],
        default: [0, 0] // [longitude, latitude]
      }
    },
    lastLocationUpdate: {
      type: Date,
      default: null
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    isApproved: {
      type: Boolean,
      default: true
    },
    totalTrips: {
      type: Number,
      default: 0
    },
    totalEarnings: {
      type: Number,
      default: 0
    },
    cancellationReason: {
      type: String,
      default: ""
    },
    documents: {
      license: { type: String, default: "" },
      insurance: { type: String, default: "" },
      registration: { type: String, default: "" }
    },
    profileImage: {
      type: String,
      default: ""
    },
    currentBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null
    },
    pushToken: {
      type: String,
      default: ""
    }
  },
  { timestamps: true }
);

driverSchema.index({ location: "2dsphere" });

driverSchema.pre('validate', function() {
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

export default mongoose.model("Driver", driverSchema);
