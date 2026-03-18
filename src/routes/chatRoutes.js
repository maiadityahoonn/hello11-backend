import express from "express";
import { getChatHistory, sendMessage } from "../controllers/chatController.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// Get chat history for a booking
router.get("/:bookingId", authenticate, getChatHistory);

// Send a chat message
router.post("/send", authenticate, sendMessage);

export default router;
