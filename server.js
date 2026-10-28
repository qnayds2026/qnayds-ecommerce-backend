const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON payloads
app.use(express.json());

// A test route
app.get("/", (req, res) => {
  res.json({ message: "Backend server is running smoothly!" });
});

// Start listening for requests
app.listen(PORT, () => {
  console.log(`Server is operating on http://localhost:${PORT}`);
});
