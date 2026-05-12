import express from "express";
import { signup, requestLoginOTP, verifyLoginOTP, forgotPassword, resetPassword } from "../controllers/authController.js";

const router = express.Router();

// signup (Request OTP)
router.post("/signup", signup);

// request login OTP
router.post("/request-otp", requestLoginOTP);

// verify OTP (for both signup and login)
router.post("/verify-otp", verifyLoginOTP);

// Legacy aliases (optional, but good for backward compatibility if needed)
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;
