import axios from "axios";
import { serverLog } from "../utils/logger.js";

const GOOGLE_MAPS_API_URL = "https://maps.googleapis.com/maps/api";
const getGoogleApiKey = () => process.env.GOOGLE_MAPS_API_KEY;

// Calculate distance between two points (Haversine formula) - shared helper
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

// Forward Geocoding: Convert address to coordinates
export const geocodeAddress = async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "Address is required" });

    // Using Google Maps Geocoding API
    const url = `${GOOGLE_MAPS_API_URL}/geocode/json`;
    serverLog(`API CALL: Geocode -> ${url}?address=${address}&key=...`);
    const response = await axios.get(url, {
      params: { address: address, key: getGoogleApiKey() }
    });

    if (response.data && response.data.status === "OK") {
      const result = response.data.results[0];
      const { lat, lng } = result.geometry.location;
      const display_name = result.formatted_address;

      res.json({
        success: true,
        data: {
          lat: lat.toString(),
          lon: lng.toString(),
          display_name: display_name,
          type: result.types[0],
        },
      });
    } else {
      const status = response.data ? response.data.status : "UNKNOWN";
      const errMsg = response.data ? response.data.error_message : "";
      serverLog(`GOOGLE ERROR [Geocode]: Status: ${status}, Message: ${errMsg}`);
      if (response.data) serverLog(`FULL RESPONSE: ${JSON.stringify(response.data)}`);
      
      res.status(404).json({
        error: "No results found for the given address",
        google_status: status,
        message: errMsg
      });
    }
  } catch (error) {
    serverLog(`Geocoding error: ${error.message}`);
    res.status(500).json({ error: "Failed to geocode address" });
  }
};

// Reverse Geocoding: Convert coordinates to address
export const reverseGeocode = async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "Lat and lon are required" });

    // Google Reverse Geocoding API
    const response = await axios.get(`${GOOGLE_MAPS_API_URL}/geocode/json`, {
      params: { latlng: `${lat},${lon}`, key: getGoogleApiKey() }
    });

    if (response.data && response.data.status === "OK") {
      const result = response.data.results[0];
      const display_name = result.formatted_address;

      res.json({
        success: true,
        data: {
          display_name: display_name,
          lat: result.geometry.location.lat,
          lon: result.geometry.location.lng,
        },
      });
    } else if (response.data && response.data.status === "ZERO_RESULTS") {
      // Return coordinates as fallback if no address found
      res.json({
        success: true,
        data: {
          display_name: `Location (${lat}, ${lon})`,
          lat: parseFloat(lat),
          lon: parseFloat(lon),
        },
      });
    } else {
      const status = response.data ? response.data.status : "UNKNOWN";
      const errMsg = response.data ? response.data.error_message : "";
      serverLog(`GOOGLE ERROR [Reverse Geocode]: Status: ${status}, Message: ${errMsg}`);
      if (response.data) serverLog(`FULL RESPONSE: ${JSON.stringify(response.data)}`);

      res.status(404).json({
        error: "No results found",
        google_status: status,
        message: errMsg
      });
    }
  } catch (error) {
    serverLog(`Reverse geocoding error: ${error.message}`);
    res.status(500).json({ error: "Failed to reverse geocode" });
  }
};

// Get route/directions between two points
export const getDirections = async (req, res) => {
  try {
    const { lat1, lon1, lat2, lon2 } = req.query;
    if (!lat1 || !lon1 || !lat2 || !lon2) return res.status(400).json({ error: "All coordinates required" });

    // Google Directions API
    const response = await axios.get(`${GOOGLE_MAPS_API_URL}/directions/json`, {
      params: {
        origin: `${lat1},${lon1}`,
        destination: `${lat2},${lon2}`,
        key: getGoogleApiKey()
      }
    });

    if (response.data && response.data.status === "OK") {
      const route = response.data.routes[0];
      const leg = route.legs[0];
      const distanceKm = (leg.distance.value / 1000).toFixed(2);

      const polyline = route.overview_polyline.points;
      const coordinates = decodePolyline(polyline);

      res.json({
        success: true,
        data: {
          distance: leg.distance.value, // meters
          duration: leg.duration.value, // seconds
          polyline: polyline,
          geometry: {
            type: "LineString",
            coordinates: coordinates
          },
          distanceKm: distanceKm,
        },
      });
    } else {
      const status = response.data ? response.data.status : "UNKNOWN";
      const errMsg = response.data ? response.data.error_message : "";
      serverLog(`GOOGLE ERROR [Directions]: Status: ${status}, Message: ${errMsg}`);
      if (response.data) serverLog(`FULL RESPONSE: ${JSON.stringify(response.data)}`);

      res.status(404).json({
        error: "No route found",
        google_status: status,
        message: errMsg
      });
    }
  } catch (error) {
    serverLog(`Directions error: ${error.message}`);
    res.status(500).json({ error: "Failed to get directions" });
  }
};

// Get autocomplete suggestions for address input fields
// Uses Google Places Autocomplete API — prefix matching, India-restricted, 50km proximity-biased
export const getAutocomplete = async (req, res) => {
  try {
    const { query, lat, lon } = req.query;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;
    const hasCoords = userLat !== null && userLon !== null && !isNaN(userLat) && !isNaN(userLon);

    // ── Google Places Autocomplete API ─────────────────────────────────────
    // This is the right API for address input fields:
    //   • Prefix matching: "Bhop" → Bhopal, "Del" → Delhi
    //   • components=country:in restricts to India at the API level
    //   • location+radius provides soft 50km proximity recommendation
    const autocompleteParams = {
      input: query,
      key: getGoogleApiKey(),
      components: "country:in",  // Hard-restrict to India at API level
      language: "en",
      types: "geocode",          // Addresses + geographic places (not just businesses)
    };

    if (hasCoords) {
      autocompleteParams.location = `${userLat},${userLon}`;
      autocompleteParams.radius = 50000;      // 50km soft proximity bias
      autocompleteParams.strictbounds = false; // Nearby first, but don't cut off distant places
    }

    serverLog(`API CALL: Autocomplete -> /place/autocomplete/json?input=${query}&key=...`);
    const acResponse = await axios.get(`${GOOGLE_MAPS_API_URL}/place/autocomplete/json`, {
      params: autocompleteParams,
    });

    if (acResponse.data && acResponse.data.status === "OK") {
      const predictions = acResponse.data.predictions || [];

      // Fetch coordinates for each prediction via Place Details
      const suggestions = await Promise.all(
        predictions.slice(0, 7).map(async (pred) => {
          try {
            const detailRes = await axios.get(`${GOOGLE_MAPS_API_URL}/place/details/json`, {
              params: {
                place_id: pred.place_id,
                key: getGoogleApiKey(),
                fields: "geometry,formatted_address",
              },
            });
            const result = detailRes.data.result;
            return {
              place_id: pred.place_id,
              display_name: pred.description,
              lat: result?.geometry?.location?.lat?.toString() || "",
              lon: result?.geometry?.location?.lng?.toString() || "",
            };
          } catch {
            return { place_id: pred.place_id, display_name: pred.description, lat: "", lon: "" };
          }
        })
      );

      const valid = suggestions.filter((s) => s.lat && s.lon);
      serverLog(`Google Autocomplete: ${valid.length} results for "${query}"`);
      return res.json({ success: true, data: valid });
    }

    // ── Fallback: Photon (OSM) ──────────────────────────────────────────────
    const status = acResponse.data ? acResponse.data.status : "UNKNOWN";
    const errMsg = acResponse.data ? acResponse.data.error_message : "";

    if (status !== "ZERO_RESULTS") {
      serverLog(`GOOGLE Autocomplete ERROR: Status: ${status}, Message: ${errMsg}`);
      serverLog("Falling back to Photon (OSM)...");
    }

    try {
      // Wide bbox (~250km) so distant cities still appear — Photon ranks centre results higher
      let photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=15&lang=en`;

      if (hasCoords) {
        const delta = 2.25; // ≈ 250km wide bounding box
        photonUrl += `&bbox=${[
          userLon - delta, // west
          userLat - delta, // south
          userLon + delta, // east
          userLat + delta, // north
        ].join(",")}`;
      }

      const photonRes = await axios.get(photonUrl);

      if (photonRes.data && photonRes.data.features) {
        let features = photonRes.data.features;

        // Hard-filter: India only
        features = features.filter((f) => {
          const cc = (f.properties.country_code || "").toLowerCase();
          const country = (f.properties.country || "").toLowerCase();
          return cc === "in" || country === "india";
        });

        // Sort nearest-first (50km = recommendation, not a hard cut-off)
        if (hasCoords) {
          features.sort((a, b) => {
            const dA = calculateDistance(userLat, userLon, a.geometry.coordinates[1], a.geometry.coordinates[0]);
            const dB = calculateDistance(userLat, userLon, b.geometry.coordinates[1], b.geometry.coordinates[0]);
            return dA - dB;
          });
        }

        const suggestions = features.map((f) => {
          const p = f.properties;
          return {
            place_id: p.osm_id ? String(p.osm_id) : Math.random().toString(),
            display_name: [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(", "),
            lat: f.geometry.coordinates[1].toString(),
            lon: f.geometry.coordinates[0].toString(),
          };
        });

        serverLog(`Photon fallback: ${suggestions.length} India results for "${query}"`);
        return res.json({ success: true, data: suggestions });
      }
    } catch (photonErr) {
      serverLog(`Photon fallback failed: ${photonErr.message}`);
    }

    res.json({ success: true, data: [], google_status: status, message: errMsg });
  } catch (error) {
    serverLog(`Autocomplete error: ${error.message}`);
    res.status(500).json({ error: "Failed to get autocomplete suggestions" });
  }
};

// Decode Google Maps encoded polyline
const decodePolyline = (encoded) => {
  const points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
};

// NOTE: calculateDistance is defined at the top of this file

// Get LocationIQ API key status (Mocked for Photon now)
export const getApiKeyStatus = (req, res) => {
  res.json({
    success: true,
    message: "Photon & OSRM APIs are active (No Key Required)",
  });
};

// Calculate distance between two points and recommend cab vs rental
export const calculateDistanceAndRecommend = async (req, res) => {
  try {
    const { lat1, lon1, lat2, lon2 } = req.body;

    if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined ||
      lat1 === null || lon1 === null || lat2 === null || lon2 === null) {
      return res.status(400).json({ error: "All coordinates required" });
    }

    // Attempt to get road distance from Google Maps for better accuracy
    let distance = 0;
    try {
      const response = await axios.get(`${GOOGLE_MAPS_API_URL}/directions/json`, {
        params: {
          origin: `${lat1},${lon1}`,
          destination: `${lat2},${lon2}`,
          key: getGoogleApiKey()
        }
      });

      if (response.data && response.data.status === "OK") {
        distance = response.data.routes[0].legs[0].distance.value / 1000;
      } else {
        distance = calculateDistance(lat1, lon1, lat2, lon2);
      }
    } catch (e) {
      serverLog(`OSRM/Google fallback error: ${e.message}`);
      distance = calculateDistance(lat1, lon1, lat2, lon2);
    }

    const recommendation = distance < 40 ? "cab" : "rental";

    res.json({
      success: true,
      data: {
        distanceKm: parseFloat(distance.toFixed(2)),
        recommendation: recommendation,
        message: distance < 40
          ? `Distance is ${distance.toFixed(2)}km - recommend cab booking`
          : `Distance is ${distance.toFixed(2)}km - recommend rental booking`
      }
    });
  } catch (error) {
    serverLog(`Distance calculation error: ${error.message}`);
    res.status(500).json({ error: "Failed to calculate distance" });
  }
};
