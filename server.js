const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Leyli Media Backend ishlayapti!"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    backend: "online",
    telegram: "ready",
    payme: "ready",
    database: "ready"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Leyli Media Backend ${PORT}-portda ishga tushdi`);
});
