import env from "dotenv";
env.config();

import express from "express";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";

import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: "Too many requests, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Too many email requests, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

app.get("/", (req, res) => {
  res.send("Email Service is running");
});

app.post("/send-email", emailLimiter, async (req, res) => {
  const { email, subject, message, pass1, pass2 } = req.body;

  if (pass1 !== process.env.PASS_1 || pass2 !== process.env.PASS_2) {
    return res.status(401).json({ message: "Unauthorized: Invalid credentials" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject,
      text: message,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Failed to send email" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email service running on port ${PORT}`);
});     
