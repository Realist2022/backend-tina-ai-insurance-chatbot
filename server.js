import express from "express";
import cors from "cors";
import chatRoutes from "./routes/ChatRoutes.js"; // Ensure the file extension is included
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api", chatRoutes);

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
