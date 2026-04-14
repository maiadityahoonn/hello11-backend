import Notification from "../models/Notification.js";
import { getIO } from "../utils/socketLogic.js";
import { serverLog } from "../utils/logger.js";

// Helper to create and emit notification
export const createNotification = async ({ userId, title, body, type, bookingId = null }) => {
    try {
        const notification = await Notification.create({
            user: userId,
            title,
            body,
            type,
            bookingId
        });

        const unreadCount = await Notification.countDocuments({
            user: userId,
            read: false
        });

        const io = getIO();
        io.to(userId.toString()).emit("newNotification", {
            notification: {
                id: notification._id,
                title: notification.title,
                body: notification.body,
                type: notification.type,
                bookingId: notification.bookingId,
                createdAt: notification.createdAt,
                read: notification.read
            },
            unreadCount // Include total unread count
        });

        serverLog(`Notification [${type}] created and emitted to user ${userId}`);
        return notification;
    } catch (error) {
        serverLog(`Error creating notification: ${error.message}`);
    }
};

// Get user notifications
export const getUserNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.userId || req.driverId })
            .sort({ createdAt: -1 })
            .limit(50);

        const unreadCount = await Notification.countDocuments({
            user: req.userId || req.driverId,
            read: false
        });

        res.json({
            notifications,
            unreadCount
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch notifications",
            error: error.message
        });
    }
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(req.params.id, { read: true });

        // Emit updated count
        const userId = req.userId || req.driverId;
        const unreadCount = await Notification.countDocuments({ user: userId, read: false });
        const io = getIO();
        io.to(userId.toString()).emit("unreadCountUpdate", { unreadCount });

        res.json({ message: "Notification marked as read", unreadCount });
    } catch (error) {
        res.status(500).json({
            message: "Failed to mark as read",
            error: error.message
        });
    }
};

// Mark all as read
export const markAllNotificationsAsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { user: req.userId || req.driverId, read: false },
            { read: true }
        );
        res.json({ message: "All notifications marked as read" });
    } catch (error) {
        res.status(500).json({
            message: "Failed to mark all as read",
            error: error.message
        });
    }
};

// Clear all notifications
export const clearNotifications = async (req, res) => {
    try {
        const userId = req.userId || req.driverId;
        await Notification.deleteMany({ user: userId });

        // Emit zero count
        const io = getIO();
        io.to(userId.toString()).emit("unreadCountUpdate", { unreadCount: 0 });

        res.json({ message: "Notifications cleared" });
    } catch (error) {
        res.status(500).json({
            message: "Failed to clear notifications",
            error: error.message
        });
    }
};
