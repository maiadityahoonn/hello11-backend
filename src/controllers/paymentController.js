import Razorpay from "razorpay";
import crypto from "crypto";
import Driver from "../models/Driver.js";
import Transaction from "../models/Transaction.js";
import { serverLog } from "../utils/logger.js";

// Initialize Razorpay
// These should be in your .env file
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "placeholder_secret"
});

// ================= CREATE ORDER =================
export const createOrder = async (req, res) => {
    try {
        const driver = await Driver.findById(req.driverId);
        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }

        const amount = Math.round(driver.pendingCommission * 100); // Amount in paise

        if (amount <= 0) {
            return res.status(400).json({ message: "No pending commission to pay" });
        }

        const options = {
            amount: amount,
            currency: "INR",
            receipt: `receipt_driver_${driver._id}_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        res.json({
            success: true,
            order,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        serverLog(`Razorpay Create Order Error: ${error.message}`);
        res.status(500).json({ message: "Failed to create payment order", error: error.message });
    }
};

// ================= VERIFY PAYMENT =================
export const verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "placeholder_secret")
            .update(body.toString())
            .digest("hex");

        const isAuthentic = expectedSignature === razorpay_signature;

        if (isAuthentic) {
            // Success: Reset driver's commission and count
            const driver = await Driver.findById(req.driverId);
            if (driver) {
                // Record the transaction before resetting balance
                await Transaction.create({
                    driver: driver._id,
                    amount: driver.pendingCommission,
                    type: "payment_to_admin",
                    status: "completed",
                    razorpayOrderId: razorpay_order_id,
                    razorpayPaymentId: razorpay_payment_id,
                    method: "razorpay",
                    note: `Commission payment for ${driver.unpaidRideCount} rides`
                });

                driver.pendingCommission = 0;
                driver.unpaidRideCount = 0;
                await driver.save();
                
                serverLog(`Payment Successful: Driver ${driver.name} paid pending commission.`);
                
                res.json({
                    success: true,
                    message: "Payment verified successfully. You can now accept rides."
                });
            } else {
                res.status(404).json({ message: "Driver not found" });
            }
        } else {
            res.status(400).json({ success: false, message: "Invalid payment signature" });
        }
    } catch (error) {
        serverLog(`Razorpay Verify Payment Error: ${error.message}`);
        res.status(500).json({ message: "Failed to verify payment", error: error.message });
    }
};
