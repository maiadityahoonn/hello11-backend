import Chat from "../models/Chat.js";

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
    } catch (error) {
        res.status(500).json({
            message: "Failed to send message",
            error: error.message
        });
    }
};
