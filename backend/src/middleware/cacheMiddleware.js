import redisClient from '../utils/redisClient.js';
import { serverLog } from '../utils/logger.js';

/**
 * Express middleware to cache GET requests.
 * Automatically serves from cache if present, otherwise hijacks res.json to save the fresh data.
 * @param {number} duration - Cache duration in seconds
 * @param {function} keyGenerator - Optional function to generate a custom key string (req) => string
 */
export const cacheData = (duration = 60, keyGenerator = null) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    try {
      // If Redis isn't connected or failed, skip caching silently
      if (!redisClient.isConnected) {
        return next();
      }

      // Generate a dynamic key based on the URL and user/driver ID if present
      // Examples: 
      // User requested: user_profile_123 : /api/users/profile
      // Driver nearby: /api/drivers/nearby
      let key = '';
      if (keyGenerator) {
        key = keyGenerator(req);
      } else {
        const idContext = req.driverId ? `driver_${req.driverId}` : (req.userId ? `user_${req.userId}` : 'public');
        const queryParams = Object.keys(req.query).length ? JSON.stringify(req.query) : '';
        key = `cache:${idContext}:${req.baseUrl}${req.path}:${queryParams}`;
      }

      // Try finding cached data
      const cachedResponse = await redisClient.getCache(key);
      
      if (cachedResponse) {
        // serverLog(`[CACHE HIT] ${key}`);
        // Inject a custom header just so frontend can know if it was cached
        res.setHeader('X-Cache', 'HIT');
        return res.json(cachedResponse);
      }

      // serverLog(`[CACHE MISS] ${key}`);
      res.setHeader('X-Cache', 'MISS');

      // Intercept the final response
      const originalJson = res.json.bind(res);
      
      res.json = (body) => {
        // Save the successful response back to Redis
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redisClient.setCache(key, body, duration);
        }
        
        // Call the original res.json logic to send the response to the client
        return originalJson(body);
      };

      next();
    } catch (err) {
      serverLog(`Cache Middleware Error: ${err.message}`);
      next(); // Continue normal flow if cache crashes
    }
  };
};

/**
 * Helper to clear cache for a specific user or driver
 * @param {string} id - User or Driver ID
 * @param {string} type - 'driver' or 'user'
 */
export const clearUserCache = async (id, type = 'driver') => {
  if (!id) return;
  try {
    const pattern = `cache:${type}_${id}:*`;
    await redisClient.clearCachePattern(pattern);
  } catch (err) {
    serverLog(`clearUserCache Error: ${err.message}`);
  }
};

