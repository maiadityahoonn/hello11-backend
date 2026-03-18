import mongoose from "mongoose";

const payoutSchema = new mongoose.Schema(
    {
        driver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Driver",
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        status: {
            type: String,
            enum: ["pending", "completed", "rejected"],
            default: "pending"
        },
        paymentMethod: {
            type: String,
            default: "Bank Transfer"
        },
        transactionId: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

export default mongoose.model("Payout", payoutSchema);
