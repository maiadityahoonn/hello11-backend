import axios from "axios";
import { serverLog } from "../utils/logger.js";

const GOOGLE_MAPS_API_URL = "https://maps.googleapis.com/maps/api";
const getGoogleApiKey = () => process.env.GOOGLE_MAPS_API_KEY;

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

// Get autocomplete suggestions for address
export const getAutocomplete = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query is required" });

    // Using Google Places Text Search to get coordinates directly
    const url = `${GOOGLE_MAPS_API_URL}/place/textsearch/json`;
    serverLog(`API CALL: Autocomplete (TextSearch) -> ${url}?query=${query}&key=...`);
    const response = await axios.get(url, {
      params: { query: query, key: getGoogleApiKey() }
    });

    if (response.data && response.data.status === "OK") {
      const suggestions = response.data.results.map((place) => {
        return {
          place_id: place.place_id,
          display_name: place.formatted_address || place.name,
          lat: place.geometry.location.lat.toString(),
          lon: place.geometry.location.lng.toString(),
        };
      });
      res.json({ success: true, data: suggestions });
    } else {
      const status = response.data ? response.data.status : "UNKNOWN";
      const errMsg = response.data ? response.data.error_message : "";

      if (status !== "ZERO_RESULTS") {
        serverLog(`GOOGLE ERROR [Autocomplete/TextSearch]: Status: ${status}, Message: ${errMsg}`);
        if (response.data) serverLog(`FULL RESPONSE: ${JSON.stringify(response.data)}`);
        serverLog("Attempting fallback to Photon (OSM)...");
      }

      // --- FALLBACK TO PHOTON (OSM) ---
      try {
        const photonRes = await axios.get(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10`);
        if (photonRes.data && photonRes.data.features) {
          const suggestions = photonRes.data.features.map((f) => {
            const props = f.properties;
            const parts = [props.name, props.city, props.state, props.country].filter(Boolean);
            return {
              place_id: f.properties.osm_id || Math.random().toString(),
              display_name: parts.join(", "),
              lat: f.geometry.coordinates[1].toString(),
              lon: f.geometry.coordinates[0].toString(),
            };
          });
          serverLog(`Photon fallback successful: found ${suggestions.length} results`);
          return res.json({ success: true, data: suggestions });
        }
      } catch (photonErr) {
        serverLog(`Photon fallback also failed: ${photonErr.message}`);
      }

      res.json({
        success: true,
        data: [],
        google_status: status,
        message: errMsg
      });
    }
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

// Calculate distance between two points (Haversine formula) - Helper
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
