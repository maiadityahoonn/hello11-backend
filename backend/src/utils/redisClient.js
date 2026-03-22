import { createClient } from 'redis';
import { serverLog } from './logger.js';
import dotenv from 'dotenv';
dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

class RedisClient {
  constructor() {
    this.client = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            serverLog(`Redis reconnect limit reached. Disabling cache.`);
            return new Error('Redis connection failed');
          }
          return Math.min(retries * 500, 3000); // Wait up to 3s before retrying
        }
      }
    });

    this.isConnected = false;

    this.client.on('connect', () => {
      serverLog(`Connected to Redis Server at ${REDIS_URL}`);
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      serverLog('Redis Client Ready');
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      serverLog(`Redis Client Error: ${err.message}`);
    });

    this.client.on('end', () => {
      this.isConnected = false;
      serverLog('Redis Client Disconnected');
    });
  }

  async connect() {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
    } catch (err) {
      serverLog(`Failed to connect to Redis: ${err.message}`);
    }
  }

  // Helper method to set cached data
  async setCache(key, value, expInSeconds = 60) {
    if (!this.isConnected) return;
    try {
      const data = JSON.stringify(value);
      await this.client.setEx(key, expInSeconds, data);
    } catch (err) {
      serverLog(`Redis setCache Error: ${err.message}`);
    }
  }

  // Helper method to get cached data
  async getCache(key) {
    if (!this.isConnected) return null;
    try {
      const data = await this.client.get(key);
      if (data) return JSON.parse(data);
      return null;
    } catch (err) {
      serverLog(`Redis getCache Error: ${err.message}`);
      return null;
    }
  }

  // Helper method to invalidate specific keys pattern (e.g., driver_profile:*)
  async clearCachePattern(pattern) {
    if (!this.isConnected) return;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        serverLog(`Redis Cache cleared for pattern: ${pattern}`);
      }
    } catch (err) {
      serverLog(`Redis clearCache Error: ${err.message}`);
    }
  }
}

const redisClient = new RedisClient();
// Automatically attempt connect in background so we don't block server start
redisClient.connect();

export default redisClient;
