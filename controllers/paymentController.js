const Razorpay = require("razorpay");
const { createBooking } = require("../models/bookingStore");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

exports.createPayment = async (_req, res) => {
  try {
    const ride_id = "123";
    const user_id = "abc";

    createBooking(ride_id, user_id);

    const order = await razorpay.orders.create({
      amount: 5000,
      currency: "INR",
      receipt: "ride_" + Date.now(),
      notes: { ride_id, user_id },
    });

    console.log("Payment created:", order.id);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
