import Chat from "../models/Chat.js";
import Booking from "../models/Booking.js";
import { sendPushNotification } from "../utils/notifications.js";

// ================= GET CHAT HISTORY =================
export const getChatHistory = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const chats = await Chat.find({ booking: bookingId }).sort({ createdAt: 1 });

        res.json({
            chats: chats.map(chat => ({
                id: chat._id,
                sender: chat.sender,
                message: chat.message,
                timestamp: chat.createdAt
            }))
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch chat history",
            error: error.message
        });
    }
};
// ================= SEND MESSAGE =================
export const sendMessage = async (req, res) => {
    try {
        const { bookingId, sender, message } = req.body;

        if (!bookingId || !sender || !message) {
            return res.status(400).json({
                message: "Booking ID, sender and message are required"
            });
        }

        const chat = await Chat.create({
            booking: bookingId,
            sender,
            message
        });

        // Emit via socket if possible
        try {
            const { getIO } = await import("../utils/socketLogic.js");
            getIO().to(`chat_${bookingId}`).emit("receiveMessage", {
                id: chat._id,
                sender: chat.sender,
                message: chat.message,
                timestamp: chat.createdAt
            });
        } catch (socketError) {
            console.error("Socket emit error in REST sendMessage:", socketError.message);
        }
        res.status(201).json({
            chat: {
                id: chat._id,
                sender: chat.sender,
                message: chat.message,
                timestamp: chat.createdAt
            }
        });

        // --- PUSH NOTIFICATIONS ---
        // Find the booking and populate users to get push tokens
        try {
            const booking = await Booking.findById(bookingId).populate("user driver");
            if (booking) {
                const recipient = sender === "user" ? booking.driver : booking.user;
                if (recipient && recipient.pushToken) {
                    const title = sender === "user" ? "Message from Passenger" : "Message from Driver";
                    sendPushNotification(
                        recipient.pushToken,
                        title,
                        message,
                        { type: "chat", bookingId }
                    );
                }
            }
        } catch (pushError) {
            console.error("Error sending push notification in REST chat:", pushError.message);
        }
    } catch (error) {
        res.status(500).json({
            message: "Failed to send message",
            error: error.message
        });
    }
};
