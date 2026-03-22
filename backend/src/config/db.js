import mongoose from "mongoose";

const connectDB = async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000 // Fail after 5 seconds
    });
    console.log("MongoDB connected");
  } catch (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
};

export default connectDB;
