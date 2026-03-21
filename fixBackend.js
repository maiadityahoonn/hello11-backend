const fs = require('fs');

let doc = fs.readFileSync('src/controllers/driverController.js', 'utf8');

const oldEarnings = `// ================= GET DRIVER EARNINGS =================
export const getDriverEarnings = async (req, res) => {
  try {
    const { period = "week" } = req.query; // day, week, month, all

    let startDate = new Date();
    switch (period) {
      case "day":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case "all":
        startDate = new Date(0);
        break;
    }

    const completedBookings = await Booking.find({
      driver: req.driverId,
      status: "completed"
    });

    const bookingTotal = (booking) =>
      Number((booking.fare || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + (booking.tollFee || 0));

    const totalEarnings = completedBookings.reduce((sum, booking) => sum + bookingTotal(booking), 0);
    const totalTrips = completedBookings.length;
    const averageFare = totalTrips > 0 ? totalEarnings / totalTrips : 0;

    // Calculate today's earnings
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEarnings = completedBookings
      .filter(booking => new Date(booking.createdAt) >= today)
      .reduce((sum, booking) => sum + bookingTotal(booking), 0);

    // Fetch payouts/activities for selected period
    const payouts = await Payout.find({
      driver: req.driverId,
      createdAt: { $gte: startDate }
    }).sort({ createdAt: -1 });

    const driver = await Driver.findById(req.driverId);
    const onlineHours = Math.round(((driver.onlineTime || 0) / 60) * 10) / 10;

    res.json({
      earnings: {
        totalEarnings,
        totalTrips,
        averageFare: Math.round(averageFare * 100) / 100,
        todayEarnings,
        onlineHours,
        period,
        activities: payouts.map(p => ({
          id: p._id,
          type: "payout",
          amount: p.amount,
          status: p.status,
          method: p.paymentMethod,`;

const newEarnings = `// ================= GET DRIVER EARNINGS =================
export const getDriverEarnings = async (req, res) => {
  try {
    const { period = "week" } = req.query; // day, week, month, all

    let startDate = new Date();
    switch (period) {
      case "day":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case "all":
        startDate = new Date(0);
        break;
    }

    const completedBookings = await Booking.find({
      driver: req.driverId,
      status: "completed"
    });

    const periodBookings = completedBookings.filter(booking => new Date(booking.createdAt) >= startDate);

    const bookingTotal = (booking) =>
      Number((booking.fare || 0) + (booking.returnTripFare || 0) + (booking.penaltyApplied || 0) + (booking.tollFee || 0));

    const totalEarnings = completedBookings.reduce((sum, booking) => sum + bookingTotal(booking), 0);
    const periodEarnings = periodBookings.reduce((sum, booking) => sum + bookingTotal(booking), 0);
    
    const totalTrips = periodBookings.length;
    const averageFare = totalTrips > 0 ? periodEarnings / totalTrips : 0;

    // Calculate today's earnings
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEarnings = completedBookings
      .filter(booking => new Date(booking.createdAt) >= today)
      .reduce((sum, booking) => sum + bookingTotal(booking), 0);

    // Fetch payouts/activities for selected period
    const payouts = await Payout.find({
      driver: req.driverId,
      createdAt: { $gte: startDate }
    }).sort({ createdAt: -1 });

    const driver = await Driver.findById(req.driverId);
    const onlineHours = Math.round(((driver.onlineTime || 0) / 60) * 10) / 10;

    res.json({
      earnings: {
        totalEarnings, // All time
        periodEarnings, // Earnings for selected period
        totalTrips, // Trips for selected period
        averageFare: Math.round(averageFare * 100) / 100, // Avg for selected period
        todayEarnings,
        onlineHours,
        period,
        activities: payouts.map(p => ({
          id: p._id,
          type: "payout",
          amount: p.amount,
          status: p.status,
          method: p.paymentMethod,`;

doc = doc.replace(oldEarnings, newEarnings);

fs.writeFileSync('src/controllers/driverController.js', doc);
console.log("Backend driver API updated");
