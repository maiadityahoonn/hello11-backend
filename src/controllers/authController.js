import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { sendWhatsAppOTP } from "../utils/whatsapp.js";

// Helper to generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ================= REQUEST LOGIN OTP =================
export const requestLoginOTP = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({ message: "Mobile number is required" });
    }

    let user = await User.findOne({ mobile });
    
    // If user doesn't exist, we can optionally redirect to signup or just allow registration via OTP
    // For now, let's assume they must be registered, or we create a "pending" user.
    if (!user) {
      return res.status(404).json({ message: "Mobile number not registered. Please sign up." });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    user.loginOtp = otp;
    user.loginOtpExpiry = otpExpiry;
    await user.save();

    const result = await sendWhatsAppOTP(mobile, otp);

    if (result.success) {
      res.json({ message: "OTP sent successfully to WhatsApp", mobile });
    } else {
      res.status(500).json({ message: "Failed to send OTP", error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: "Error requesting OTP", error: error.message });
  }
};

// ================= VERIFY LOGIN OTP =================
export const verifyLoginOTP = async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({ message: "Mobile and OTP are required" });
    }

    const user = await User.findOne({ mobile });

    if (!user || !user.loginOtp) {
      return res.status(400).json({ message: "Invalid request" });
    }

    if (user.loginOtp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (user.loginOtpExpiry < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    // Clear OTP after successful verification
    user.loginOtp = null;
    user.loginOtpExpiry = null;
    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Login verification failed", error: error.message });
  }
};

// ================= SIGNUP (REQUEST OTP) =================
export const signup = async (req, res) => {
  try {
    const { name, mobile } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ message: "Name and mobile are required" });
    }

    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({ message: "Mobile number already registered" });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // We can store a temporary user or just send the OTP and expect the frontend to send details back during verification
    // To keep it simple, we'll use the existing User model but mark it as not fully verified or just create it directly if we trust the flow.
    // For now, let's create the user with the OTP.
    const user = await User.create({
      name,
      mobile,
      loginOtp: otp,
      loginOtpExpiry: otpExpiry
    });

    const result = await sendWhatsAppOTP(mobile, otp);

    if (result.success) {
      res.status(201).json({ message: "Registration OTP sent successfully", mobile });
    } else {
      await User.findByIdAndDelete(user._id); // Cleanup if SMS fails
      res.status(500).json({ message: "Failed to send registration OTP", error: result.error });
    }

  } catch (error) {
    res.status(500).json({ message: "Signup failed", error: error.message });
  }
};

// ================= FORGOT PASSWORD (LEGACY - NOW REUSED FOR OTP) =================
// Note: forgotPassword and signin are now essentially the same in an OTP system.
export const forgotPassword = requestLoginOTP;
export const resetPassword = verifyLoginOTP;
