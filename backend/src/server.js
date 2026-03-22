import 'dotenv/config';

import http from "http";
import { Server } from "socket.io";
import app from "./app.js";
import connectDB from "./config/db.js";
import { initSocket } from "./utils/socketLogic.js";
import { clearLog, serverLog } from "./utils/logger.js";
import { startScheduledRideDispatcher } from "./utils/scheduledRideDispatcher.js";

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// connect database first, then start server
const startServer = async () => {
  try {
    clearLog();
    serverLog("--- Server Starting ---");
    await connectDB();
    serverLog("Database connected");
    startScheduledRideDispatcher();   // Start cron for scheduled rides
    server.listen(PORT, () => {
      serverLog(`Server running on port ${PORT}`);
    });
  } catch (error) {
    serverLog(`Start Error: ${error.message}`);
    process.exit(1);
  }
};

startServer();
