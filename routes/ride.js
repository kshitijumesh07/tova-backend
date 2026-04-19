const express = require("express");
const router = express.Router();

const rides = [
  { id: "1", from: "Sainikpuri", to: "Hitech City", time: "8:00 AM", price: 50 },
  { id: "2", from: "Sainikpuri", to: "Hitech City", time: "8:30 AM", price: 60 },
];

router.post("/search", (req, res) => {
  res.json(rides);
});

router.post("/book", (req, res) => {
  const { id } = req.body;
  const ride = rides.find((r) => r.id === id);
  if (!ride) {
    return res.status(404).json({ error: "Ride not found" });
  }
  res.json(ride);
});

module.exports = router;
