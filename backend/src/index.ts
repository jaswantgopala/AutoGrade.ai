import dotenv from 'dotenv';
// Load environment variables FIRST, before any other imports
dotenv.config();
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import express, { Request, Response } from 'express';
import path from 'path';
import passport from './auth/passport';  // passport configuration
import { json } from 'body-parser';
import authRoute from './routes/authRoute';  // our authRoute
import userRoute from './routes/userRoute';  // our userRoute
import driveRoute from './routes/driveRoute';
import classroomRoute from './routes/classroomRoute';
import paymentRoute from './routes/paymentRoute';
import { startGradingWorker } from './workers/gradingWorker';
// import aiWorkerRoute from './routes/aiWorkerRoute';
import connectDB from './database/db';

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.FE_BASE_URL,
  'https://autograde-frontend.vercel.app',
  'http://localhost:3001',
].filter(
  (origin): origin is string => Boolean(origin)
);

// CORS middleware
// app.use((req: Request, res: Response, next) => {
//   const allowedOrigins = [process.env.FE_BASE_URL, 'http://localhost:3001'];
//   const origin = req.headers.origin;

//   if (origin && allowedOrigins.includes(origin)) {
//     res.setHeader('Access-Control-Allow-Origin', origin);
//   }
//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//   res.setHeader('Access-Control-Allow-Credentials', 'true');

//   if (req.method === 'OPTIONS') {
//     return res.sendStatus(200);
//   }
//   next();
// });
app.use(cors({
  origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS','PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-idempotency-key'],
    credentials: true
}))

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many auth requests, try again later.' },
});

const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many payment requests, try again later.' },
});

const gradingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many grading requests, try again later.' },
});

// Razorpay webhook signature verification requires raw request body.
app.use('/api/payments/razorpay/webhook', express.raw({ type: 'application/json' }));

// middleware to parse json bodies - reduced limit to prevent DOS
app.use(json({ limit: '1mb' }));

// authRoute
app.use('/api/auth', authLimiter, authRoute);

// userRoute
app.use('/api/user', userRoute);

// driveRoute (test-only)
app.use('/api/drive', gradingLimiter, driveRoute);

// classroomRoute
app.use('/api/classroom', gradingLimiter, classroomRoute);

// paymentRoute
app.use('/api/payments', paymentLimiter, paymentRoute);

// // aiWorkerRoute
// app.use('/api/ai-worker', aiWorkerRoute);

// simple frontend page to test auth + protected endpoints (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.get('/test', (req: Request, res: Response) => {
    return res.sendFile(path.join(process.cwd(), 'src', 'public', 'test.html'));
  });
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    googleConfigured: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: `${process.env.BE_BASE_URL}/api/auth/google/callback`,
  });
});

// default route
app.get('/', (req: Request, res: Response) => {
  res.send('welcome to the Google OAuth 2.0 + JWT Node.js app!');
});

// start the server
const PORT = process.env.PORT || 3000;

let dbConnected = false;
let workerStarted = false;

async function initializeBackgroundServices() {
  try {
    await connectDB();
    dbConnected = true;
  } catch (error) {
    console.error('MongoDB initialization failed:', error);
  }

  try {
    startGradingWorker();
    workerStarted = true;
  } catch (error) {
    console.error('Grading worker initialization failed:', error);
  }
}

let server: any;

async function startServer() {
  server = app.listen(PORT, () => {
    console.log(`server is running on http://localhost:${PORT}`);
  });

  // Initialize external services after server starts so Cloud Run can pass startup checks.
  await initializeBackgroundServices();
}

startServer();

// Graceful shutdown handling
function shutdownGracefully(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    
    // Force close after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));