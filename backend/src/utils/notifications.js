import { Expo } from "expo-server-sdk";
import { serverLog } from "./logger.js";

const expo = new Expo();

/**
 * Send a push notification via Expo.
 * @param {string} pushToken - Valid Expo push token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Optional data payload
 */
export const sendPushNotification = async (pushToken, title, body, data = {}) => {
  if (!Expo.isExpoPushToken(pushToken)) {
    serverLog(`Push token ${pushToken} is not a valid Expo push token`);
    return;
  }

  const messages = [{
    to: pushToken,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'default',
  }];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    serverLog(`Push notification sent to: ${pushToken}`);
  } catch (error) {
    serverLog(`Error sending push notification: ${error.message}`);
  }
};
