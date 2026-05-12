import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    mobile: {
      type: String,
      required: true,
      unique: true
    },
    email: {
      type: String,
      default: ""
    },
    gender: {
      type: String,
      enum: ["male", "female", "other", ""],
      default: ""
    },
    password: {
      type: String,
      required: false
    },
    loginOtp: {
      type: String,
      default: null
    },
    loginOtpExpiry: {
      type: Date,
      default: null
    },
    profileImage: {
      type: String,
      default: ""
    },
    pushToken: {
      type: String,
      default: ""
    }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
