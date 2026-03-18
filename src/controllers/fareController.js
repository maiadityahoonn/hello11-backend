// ─────────────────────────────────────────────────────────────────────────────
// Step-based fare structure – identical for Cab Service & Rental Car Service
// up to 40 KM.
//
// KM 1  → ₹69   (cumulative: ₹69)
// KM 2  → ₹59   (cumulative: ₹128)
// KM 3  → ₹49   (cumulative: ₹177)
// KM 4  → ₹39   (cumulative: ₹216)
// KM 5  → ₹29   (cumulative: ₹245)
// KM 6–15  → ₹29 / km  (10 km × ₹29 = ₹290 → cumulative ₹535 at 15 km)
// KM 16–40 → ₹22 / km  (25 km × ₹22 = ₹550 → cumulative ₹1085 at 40 km)
//
// Beyond 40 KM (Rental Car Service only):
//   5-seater → ₹12 / km
//   7-seater → ₹13 / km
//
// Time allocation:
//   First 40 KM → 12 min / km
//   Beyond 40 KM → 4 min / km
//
// Return trip → 50% discount on one-way fare
// ─────────────────────────────────────────────────────────────────────────────

// Per-km rate beyond 40 KM for Rental Car Service
const RENTAL_EXTRA_RATES = {
  "5seater": 12,
  "7seater": 13,
};

// Legacy Rates (Used in calculateFareEstimate)
const CAB_RATES = {
  "Mini": 12,
  "Sedan": 15,
  "SUV": 20
};

const OUTSTATION_RATES = {
  "mini": 12,
  "sedan": 15,
  "suv": 20,
  "default": 15
};


/**
 * Calculate the step-based fare for the first 40 KM (same for both services).
 * Returns the fare in ₹ for any distance between 0 and 40 KM (inclusive).
 * 1 KM -> ₹69
 * 2 KM -> ₹128
 * 3 KM -> ₹177
 * 4 KM -> ₹216
 * 5 KM -> ₹245
 * 5-15 KM -> +₹29/km
 * 15-40 KM -> +₹22/km
 * @param {number} km - distance in kilometres (0 ≤ km ≤ 40)
 * @returns {number} fare in ₹
 */
const calcFareUpTo40 = (km) => {
  if (km <= 0) return 0;

  // Exact cumulative totals for km 1-5
  const stepTotals = [69, 128, 177, 216, 245];
  const whole = Math.floor(km);
  const fraction = km - whole;

  let fare = 0;

  if (whole < 5) {
    fare = stepTotals[Math.max(0, whole - 1)] || 0;
    // For fractional part between steps
    const nextStepRate = [69, 59, 49, 39, 29][whole];
    fare += (whole === 0 ? km : fraction) * nextStepRate;
  } else if (whole < 15) {
    // fare at 5 KM is 245
    fare = 245 + (km - 5) * 29;
  } else {
    // fare at 15 KM: 245 + 10*29 = 245 + 290 = 535
    fare = 535 + (km - 15) * 22;
  }

  return Math.round(fare);
};

/**
 * Calculate allowed time (minutes) for the trip.
 * First 1-40 KM -> 12 min / km (Max 480 min / 8 hours at 40km)
 * Beyond 40 KM -> 4 min / km
 * @param {number} km - total distance in kilometres
 * @returns {number} total allowed time in minutes
 */
export const calcAllowedTime = (km) => {
  if (km <= 0) return 0;
  const baseKm = Math.min(km, 40);
  const extraKm = Math.max(km - 40, 0);
  return Math.round(baseKm * 12 + extraKm * 4);
};

// Get cab fare rates - Updated for 5/7 seater
export const getCabRates = (req, res) => {
  res.json({
    success: true,
    data: {
      cabTypes: [
        { type: "5-seater", ratePerKm: 0, currency: "INR", description: "Standard 5-seater car" },
        { type: "7-seater", ratePerKm: 0, currency: "INR", description: "Spacious 7-seater car" },
      ],
      description: "Step-based pricing: ₹1085 for first 40km, then per-km rates apply for 40km+."
    },
  });
};

// Get outstation fare rates - Consolidated to 5/7 seater
export const getOutstationRates = (req, res) => {
  res.json({
    success: true,
    data: {
      vehicleTypes: [
        { type: "5seater", title: "5 Seater Car", ratePerKm: 12, icon: "car-outline", desc: "Comfortable hatchback/sedan", capacity: "4" },
        { type: "7seater", title: "7 Seater Car", ratePerKm: 13, icon: "bus-outline", desc: "Spacious SUV for families", capacity: "6" },
      ],
      currency: "INR",
    },
  });
};

// Calculate fare estimate
export const calculateFareEstimate = (req, res) => {
  try {
    const { distanceKm, hours, cabType, bookingType } = req.body;

    // Default values
    const distance = parseFloat(distanceKm) || 0;
    const bookingTypeValue = bookingType || "cab";
    const cabTypeValue = cabType || "Mini";

    if (bookingTypeValue === "cab") {
      // Cab booking calculation
      if (!distance || distance <= 0) {
        return res.status(400).json({ error: "Valid distance in km is required for cab booking" });
      }

      const ratePerKm = CAB_RATES[cabTypeValue];
      if (!ratePerKm) {
        return res.status(400).json({ error: "Invalid cab type. Choose: Mini, Sedan, or SUV" });
      }

      const estimatedFare = distance * ratePerKm;

      res.json({
        success: true,
        data: {
          bookingType: "cab",
          cabType: cabTypeValue,
          distanceKm: distance,
          ratePerKm: ratePerKm,
          estimatedFare: Math.round(estimatedFare),
          currency: "INR",
          breakdown: {
            baseFare: 0,
            distanceCharge: `${distance} km × ₹${ratePerKm}/km`,
            total: `₹${Math.round(estimatedFare)}`,
          },
        },
      });
    } else if (bookingTypeValue === "outstation") {
      // Outstation booking calculation
      if (!distance || distance <= 0) {
        return res.status(400).json({ error: "Valid distance in km is required for outstation booking" });
      }

      const ratePerKm = OUTSTATION_RATES[cabTypeValue.toLowerCase()] || OUTSTATION_RATES.default;
      const estimatedFare = distance * ratePerKm;

      res.json({
        success: true,
        data: {
          bookingType: "outstation",
          cabType: cabTypeValue,
          distanceKm: distance,
          ratePerKm: ratePerKm,
          estimatedFare: Math.round(estimatedFare),
          currency: "INR",
          breakdown: {
            baseFare: 0,
            distanceCharge: `${distance} km × ₹${ratePerKm}/km`,
            total: `₹${Math.round(estimatedFare)}`,
          },
        },
      });
    } else {
      return res.status(400).json({ error: "Invalid booking type. Choose: cab or outstation" });
    }
  } catch (error) {
    console.error("Fare estimation error:", error.message);
    res.status(500).json({ error: "Failed to calculate fare estimate" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Fare API for Cab Service & Rental Car Service
//
// Request body:
//   distance    {number}  - trip distance in KM (required, ≥ 1)
//   carType     {string}  - "5seater" | "7seater" (required)
//   service     {string}  - "cab" | "rental" (required)
//   tripType    {string}  - "one-way" | "round-trip" (default: "one-way")
//   bookingTime {string}  - ISO datetime string of the booking (optional)
//                           If hour ≥ 18 (6 PM) or < 9 (9 AM) → 20% night surcharge
//
// Response:
//   service, carType, distance, tripType,
//   oneWayFare, allowedTimeMinutes, allowedTimeHours,
//   isNightSurcharge, nightSurcharge,
//   returnFare (if round-trip), totalFare,
//   breakdown { ... }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when a 20% night surcharge applies.
 * Surcharge window: 6 PM (18:00) – 9 AM (09:00)
 * @param {string|Date|undefined} bookingTime - ISO string or Date object
 */
const isNightTime = (bookingTime) => {
  const date = bookingTime ? new Date(bookingTime) : new Date();
  const hour = date.getHours(); // local server hour
  return hour >= 18 || hour < 9;
};
export const calculateTripFare = (req, res) => {
  try {
    const {
      distance: rawDistance,
      carType,
      service,
      tripType = "one-way",
      bookingTime,       // optional ISO datetime string
    } = req.body;

    // ── Validate inputs ────────────────────────────────────────────────────
    const distance = parseFloat(rawDistance);
    if (isNaN(distance) || distance < 1) {
      return res.status(400).json({
        success: false,
        error: "distance must be a number ≥ 1 KM.",
      });
    }

    const validCarTypes = ["5seater", "7seater"];
    if (!validCarTypes.includes(carType)) {
      return res.status(400).json({
        success: false,
        error: `carType must be one of: ${validCarTypes.join(", ")}.`,
      });
    }

    const validServices = ["cab", "rental"];
    if (!validServices.includes(service)) {
      return res.status(400).json({
        success: false,
        error: `service must be one of: ${validServices.join(", ")}.`,
      });
    }

    // Cab Service: max 40 KM
    if (service === "cab" && distance > 40) {
      return res.status(400).json({
        success: false,
        error: "Cab Service allows a maximum trip distance of 40 KM. For longer distances please use Rental Car Service.",
      });
    }

    const validTripTypes = ["one-way", "round-trip"];
    if (!validTripTypes.includes(tripType)) {
      return res.status(400).json({
        success: false,
        error: `tripType must be one of: ${validTripTypes.join(", ")}.`,
      });
    }

    // ── Fare calculation ───────────────────────────────────────────────────
    const baseKm = Math.min(distance, 40);
    const extraKm = Math.max(distance - 40, 0);

    // Step-based fare for first 40 KM (identical for both services & both car types)
    const first40Fare = calcFareUpTo40(baseKm);

    // Extra fare (> 40 KM, Rental only)
    const extraRatePerKm = RENTAL_EXTRA_RATES[carType] || 12;
    const extraFare = Math.round(extraKm * extraRatePerKm);

    let oneWayFare = first40Fare + extraFare;

    // ── Night surcharge (6 PM – 9 AM → +20%) ──────────────────────────────
    const nightSurchargeApplies = isNightTime(bookingTime);
    const nightSurcharge = nightSurchargeApplies ? Math.round(oneWayFare * 0.20) : 0;
    oneWayFare = oneWayFare + nightSurcharge;

    // ── Time calculation ───────────────────────────────────────────────────
    const allowedTimeMinutes = calcAllowedTime(distance);
    const allowedTimeHours = parseFloat((allowedTimeMinutes / 60).toFixed(2));

    // ── Return trip (50% discount) ─────────────────────────────────────────
    const isRoundTrip = tripType === "round-trip";
    const returnFare = isRoundTrip ? Math.round(oneWayFare * 0.5) : 0;
    const totalFare = oneWayFare + returnFare;

    // ── Breakdown for transparency ─────────────────────────────────────────
    const breakdown = {
      first40KmFare: `₹${first40Fare} (step-based pricing up to 40 KM)`,
    };

    if (extraKm > 0) {
      breakdown.extraDistanceFare =
        `${extraKm} km × ₹${extraRatePerKm}/km = ₹${extraFare}`;
    }

    if (nightSurchargeApplies) {
      breakdown.nightSurcharge = `20% night surcharge (6 PM – 9 AM) = ₹${nightSurcharge}`;
    }

    breakdown.oneWayFare = `₹${oneWayFare}`;

    if (isRoundTrip) {
      breakdown.returnFare = `50% of ₹${oneWayFare} = ₹${returnFare}`;
      breakdown.totalFare = `₹${oneWayFare} + ₹${returnFare} = ₹${totalFare}`;
    }

    breakdown.allowedTime = `${allowedTimeMinutes} minutes (${allowedTimeHours} hours)`;

    // ── Response ───────────────────────────────────────────────────────────
    return res.json({
      success: true,
      data: {
        service,
        carType,
        distanceKm: distance,
        tripType,
        currency: "INR",
        isNightSurcharge: nightSurchargeApplies,
        nightSurcharge,
        oneWayFare,
        allowedTimeMinutes,
        allowedTimeHours,
        ...(isRoundTrip && { returnFare }),
        totalFare,
        breakdown,
      },
    });
  } catch (error) {
    console.error("Trip fare calculation error:", error.message);
    res.status(500).json({ success: false, error: "Failed to calculate trip fare." });
  }
};
