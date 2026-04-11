import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ["payment_to_admin", "payout_to_driver"],
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending"
    },
    razorpayOrderId: {
      type: String,
      default: ""
    },
    razorpayPaymentId: {
      type: String,
      default: ""
    },
    method: {
      type: String,
      default: "razorpay"
    },
    note: {
      type: String,
      default: ""
    }
  },
  { timestamps: true }
);

// Indexes
transactionSchema.index({ driver: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });

export default mongoose.model("Transaction", transactionSchema);
