import path from "node:path";
import process from "node:process";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Driver from "../src/models/Driver.js";

const backendDir = path.resolve(process.cwd());
dotenv.config({ path: path.join(backendDir, ".env") });

const BASE = "http://127.0.0.1:5001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 150000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("Server did not become ready in time");
}

async function api(method, url, token, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new Error(`${method} ${url} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function loginOrCreateUser(mobile, password) {
  try {
    await api("POST", "/api/auth/signup", null, { name: "Test User", mobile, password });
  } catch {}
  const login = await api("POST", "/api/auth/signin", null, { mobile, password });
  return login.token;
}

async function loginOrCreateDriver(mobile, password) {
  try {
    await api("POST", "/api/drivers/register", null, {
      name: "Test Driver",
      mobile,
      password,
      vehicleNumber: "DL01AB1234",
      vehicleModel: "Swift",
      vehicleType: "5seater",
      serviceType: "both",
    });
  } catch {}

  const login = await api("POST", "/api/drivers/login", null, { mobile, password });
  const driverId = login.driver?.id;
  if (!driverId) throw new Error("Driver login missing id");
  return { token: login.token, driverId };
}

async function run() {
  const stamp = Date.now().toString().slice(-7);
  const userMobile = `91${stamp}01`;
  const user2Mobile = `93${stamp}03`;
  const driverMobile = `92${stamp}02`;
  const pass = "123456";

  let ok = false;
  try {
    await waitForServer();
    console.log("Server ready");

    const userToken = await loginOrCreateUser(userMobile, pass);
    const user2Token = await loginOrCreateUser(user2Mobile, pass);
    const { token: driverToken, driverId } = await loginOrCreateDriver(driverMobile, pass);

    await mongoose.connect(process.env.MONGO_URI);
    await Driver.findByIdAndUpdate(driverId, {
      isVerified: true,
      online: true,
      available: true,
      serviceType: "both",
      location: { type: "Point", coordinates: [77.209, 28.6139] },
      latitude: 28.6139,
      longitude: 77.209,
    });
    await mongoose.disconnect();

    await api("PUT", "/api/drivers/location", driverToken, {
      latitude: 28.6139,
      longitude: 77.209,
    });

    const scheduledAt = new Date(Date.now() + 70 * 1000).toISOString();
    const scheduled = await api("POST", "/api/bookings", userToken, {
      pickupLocation: "Connaught Place",
      dropLocation: "India Gate",
      pickupLatitude: 28.6139,
      pickupLongitude: 77.209,
      dropLatitude: 28.6129,
      dropLongitude: 77.2295,
      rideType: "normal",
      bookingType: "schedule",
      scheduledDate: scheduledAt,
      fare: 250,
      distance: 6,
      duration: 20,
      vehicleType: "5seater",
    });
    const scheduledId = scheduled.booking?.id;

    await api("POST", `/api/drivers/bookings/${scheduledId}/accept`, driverToken, {});

    const nowRide = await api("POST", "/api/bookings", user2Token, {
      pickupLocation: "Rajiv Chowk",
      dropLocation: "Mandi House",
      pickupLatitude: 28.6328,
      pickupLongitude: 77.2197,
      dropLatitude: 28.6257,
      dropLongitude: 77.2334,
      rideType: "normal",
      bookingType: "now",
      fare: 180,
      distance: 4,
      duration: 15,
      vehicleType: "5seater",
    });
    const nowId = nowRide.booking?.id;
    await api("POST", `/api/drivers/bookings/${nowId}/accept`, driverToken, {});

    console.log(`Created scheduled=${scheduledId}, now=${nowId}. Waiting for scheduler window...`);
    await sleep(110000);

    const scheduledStatus = await api("GET", `/api/bookings/${scheduledId}/status`, userToken);
    const b = scheduledStatus.booking;
    const passCondition = b?.status === "pending" && !b?.driver;

    console.log("Scheduled booking after conflict:", {
      status: b?.status,
      hasDriver: Boolean(b?.driver),
      bookingType: b?.bookingType,
      scheduledDate: b?.scheduledDate,
    });

    ok = passCondition;
    console.log(passCondition ? "PASS: Conflict auto-reassign works." : "FAIL: Conflict auto-reassign did not happen.");
    return ok;
  } finally {
    try {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    } catch {}
  }
}

run()
  .then((ok) => process.exit(ok ? 0 : 2))
  .catch(async (err) => {
    console.error("Test crashed:", err.message);
    try {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    } catch {}
    process.exit(1);
  });
