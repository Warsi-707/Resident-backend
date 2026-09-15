import 'dotenv/config';

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'rwa-super-secret-jwt-key-2026-change-in-production';
}

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

import authRouter from './routes/auth';
import membersRouter from './routes/members';
import staffRouter from './routes/staff';
import challansRouter from './routes/challans';
import paymentsRouter from './routes/payments';
import dashboardRouter from './routes/dashboard';
import reportsRouter from './routes/reports';
import settingsRouter from './routes/settings';
import activityRouter from './routes/activity';
import resetRouter from './routes/reset';
import whatsappWebhookRouter from './routes/whatsappWebhook';
import whatsappBaileysRouter from './routes/whatsappBaileys';
import { getWhatsAppScanHtml } from './utils/whatsappScanHtml';

// 1. Initialize Express Application
const app = express();

// 2. Safe Uploads directory initialization (with fallback for read-only serverless filesystems)
const uploadsDir = process.env.VERCEL
  ? path.join('/tmp', 'uploads')
  : path.join(process.cwd(), 'uploads');

try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch {
  // Gracefully handle read-only environments
}

// 3. Permissive CORS (supports frontend running on any Vercel domain or localhost)
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. URL Normalization Middleware
app.use((req, _res, next) => {
  const matchedPath =
    (req.headers['x-matched-path'] as string) ||
    (req.headers['x-now-route-matches'] as string) ||
    (req.headers['x-forwarded-uri'] as string);

  if (matchedPath && matchedPath.startsWith('/api') && !matchedPath.startsWith('/api/index')) {
    req.url = matchedPath;
  }

  if (req.url.startsWith('/api/api/')) {
    req.url = req.url.replace(/^\/api\/api\//, '/api/');
  } else if (
    !req.url.startsWith('/api') &&
    !req.url.startsWith('/uploads') &&
    !req.url.startsWith('/whatsapp-')
  ) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

// 5. Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// 6. Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'RWA Collection & Reporting API',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// 7. REST API Routes
app.use('/api/auth', authRouter);
app.use('/api/members', membersRouter);
app.use('/api/staff', staffRouter);
app.use('/api/challans', challansRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/activity', activityRouter);
app.use('/api/reset-sample-data', resetRouter);
app.use('/api/whatsapp', whatsappWebhookRouter);
app.use('/api/whatsapp', whatsappBaileysRouter);

// 8. Dedicated WhatsApp Connection & QR Scan Portal
app.get('/whatsapp-scan', (_req, res) => res.send(getWhatsAppScanHtml()));
app.get('/whatsapp-connect', (_req, res) => res.send(getWhatsAppScanHtml()));

// 9. Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Express Server Error]:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error', message: err?.message || String(err) });
  }
});

// 10. Fallback 404 handler
app.use((req, res) => {
  if (!res.headersSent) {
    res.status(404).json({
      error: 'Endpoint not found',
      method: req.method,
      url: req.url,
    });
  }
});

export { app };
export default app;
