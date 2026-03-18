import { Server } from "socket.io";
import { serverLog } from "./logger.js";
import Chat from "../models/Chat.js";

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", (socket) => {
        serverLog(`New socket connection: ${socket.id}`);

        socket.on("join", (userId) => {
            if (!userId) {
                serverLog(`WARN: Socket ${socket.id} joined with empty ID`);
                return;
            }
            socket.join(userId);
            serverLog(`Socket ${socket.id} joined room: ${userId}`);

            const rooms = Array.from(socket.rooms);
            serverLog(`Socket ${socket.id} active rooms: ${JSON.stringify(rooms)}`);
        });

        // --- CHAT EVENTS ---
        socket.on("joinChat", (bookingId) => {
            if (!bookingId) return;
            const roomName = `chat_${bookingId}`;
            socket.join(roomName);
            serverLog(`[CHAT] Socket ${socket.id} joined room: ${roomName}`);

            // Log all rooms for this socket to verify
            const rooms = Array.from(socket.rooms);
            serverLog(`[CHAT] Socket ${socket.id} current rooms: ${JSON.stringify(rooms)}`);
        });

        socket.on("sendMessage", async (data) => {
            const { bookingId, sender, message } = data;
            serverLog(`[CHAT] Message received: From=${sender}, Booking=${bookingId}, Text=${message.substring(0, 20)}...`);

            if (!bookingId || !message) {
                serverLog(`[CHAT] ERROR: Missing bookingId or message in sendMessage`);
                return;
            }

            try {
                // Save to DB
                const newChat = await Chat.create({
                    booking: bookingId,
                    sender,
                    message
                });

                // Emit to room
                const roomName = `chat_${bookingId}`;
                io.to(roomName).emit("receiveMessage", {
                    id: String(newChat._id),
                    sender,
                    message,
                    timestamp: newChat.createdAt
                });
                serverLog(`[CHAT] Broadcasted msg to room: ${roomName}, Sender: ${sender}, ID: ${newChat._id}`);
            } catch (err) {
                serverLog(`[CHAT] DB Error saving chat: ${err.message}`);
            }
        });

        socket.on("disconnect", () => {
            serverLog(`Client disconnected: ${socket.id}`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};
