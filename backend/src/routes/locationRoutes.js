import express from "express";
import {
  geocodeAddress,
  reverseGeocode,
  getDirections,
  getAutocomplete,
  getApiKeyStatus,
  calculateDistanceAndRecommend,
} from "../controllers/locationController.js";

const router = express.Router();

// Geocoding endpoints
router.get("/geocode", geocodeAddress); // Forward geocoding: address -> coordinates
router.get("/reverse", reverseGeocode); // Reverse geocoding: coordinates -> address
router.get("/directions", getDirections); // Get route between two points
router.get("/autocomplete", getAutocomplete); // Address autocomplete suggestions

// Distance calculation endpoint
router.post("/distance", calculateDistanceAndRecommend); // Calculate distance and recommend cab/rental

// API status endpoint
router.get("/status", getApiKeyStatus);

export default router;
