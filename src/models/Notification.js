import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        title: {
            type: String,
            required: true
        },
        body: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ["ride_accepted", "ride_nearby", "ride_arrived", "ride_started", "ride_completed", "ride_cancelled", "promo", "system"],
            required: true
        },
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking"
        },
        read: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);
