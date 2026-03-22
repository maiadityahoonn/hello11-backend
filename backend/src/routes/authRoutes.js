import express from "express";
import { signup, signin, forgotPassword, resetPassword } from "../controllers/authController.js";

const router = express.Router();

// signup
router.post("/signup", signup);

// login
router.post("/signin", signin);
// forgot password
router.post("/forgot-password", forgotPassword);

// reset password
router.post("/reset-password", resetPassword);

export default router;
