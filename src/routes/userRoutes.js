import express from "express";
import { getProfile, updateProfile, getHistory, changePassword, submitReview } from "../controllers/userController.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// User profile routes
router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.put("/password", changePassword);
router.get("/history", getHistory);
router.post("/rate-driver", submitReview);

export default router;
