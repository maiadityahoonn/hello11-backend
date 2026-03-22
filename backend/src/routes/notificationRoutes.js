import express from "express";
import {
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearNotifications
} from "../controllers/notificationController.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// Get notification (can be called by both user and driver)
router.get("/", authenticate, getUserNotifications);

router.patch("/:id/read", authenticate, markNotificationAsRead);
router.patch("/read-all", authenticate, markAllNotificationsAsRead);
router.delete("/clear", authenticate, clearNotifications);

export default router;
