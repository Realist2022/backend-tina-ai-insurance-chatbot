// server.js

const express = require("express");
const cors = require("cors");
const chatRoutes = require("./routes/ChatRoutes"); // Corrected path // This path is correct based on our refactoring
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api", chatRoutes);

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
