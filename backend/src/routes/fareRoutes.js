import express from "express";
import {
  getCabRates,
  getOutstationRates,
  calculateFareEstimate,
  calculateTripFare,
} from "../controllers/fareController.js";

const router = express.Router();

// GET /api/fare/cab - Get cab fare rates
router.get("/cab", getCabRates);

// GET /api/fare/outstation - Get outstation fare rates
router.get("/outstation", getOutstationRates);

// POST /api/fare/estimate - Calculate fare estimate (legacy)
router.post("/estimate", calculateFareEstimate);

// POST /api/fare/trip - Calculate trip fare (Cab Service & Rental Car Service)
router.post("/trip", calculateTripFare);

export default router;
