import jwt from "jsonwebtoken";

export const authenticateDriver = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    
    if (!token) {
      return res.status(401).json({
        message: "Access denied. No token provided."
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if it's a driver token
    if (!decoded.driverId) {
      return res.status(401).json({
        message: "Invalid token. Driver token required."
      });
    }
    
    req.driverId = decoded.driverId;
    next();
  } catch (error) {
    res.status(401).json({
      message: "Invalid token"
    });
  }
};

// Optional authentication - doesn't fail if no token
export const optionalAuth = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.driverId) {
        req.driverId = decoded.driverId;
      } else if (decoded.userId) {
        req.userId = decoded.userId;
      }
    }
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};
