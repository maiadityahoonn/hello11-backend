import jwt from "jsonwebtoken";

export const authenticate = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        message: "Access denied. No token provided."
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.userId) {
      req.userId = decoded.userId;
    } else if (decoded.driverId) {
      req.driverId = decoded.driverId;
    } else {
      return res.status(401).json({ message: "Invalid token type" });
    }
    next();
  } catch (error) {
    res.status(401).json({
      message: "Invalid token"
    });
  }
};
