/**
 * WhatsApp Baileys Routes
 * ========================
 * GET  /api/whatsapp/status     → connection state + QR code (base64 PNG)
 * POST /api/whatsapp/connect    → start connection / generate QR
 * POST /api/whatsapp/disconnect → logout and clear session
 * POST /api/whatsapp/test       → send test message to a phone number
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  reconnectWhatsApp,
  getWhatsAppState,
  sendWhatsAppText,
} from '../utils/baileysBridge';
import { getWhatsAppScanHtml } from '../utils/whatsappScanHtml';

const router = Router();

// ─── GET /api/whatsapp/scan & /connect-tab ─────────────────────
// Serves standalone HTML scanner page for new tab
router.get('/scan', (_req: Request, res: Response): any => {
  return res.send(getWhatsAppScanHtml());
});
router.get('/connect-tab', (_req: Request, res: Response): any => {
  return res.send(getWhatsAppScanHtml());
});

// ─── GET /api/whatsapp/live-status ────────────────────────────
// Lenient status check for the new-tab scan page
router.get('/live-status', async (_req: Request, res: Response): Promise<any> => {
  try {
    const state = getWhatsAppState();
    return res.json({
      connected: state.connected,
      connecting: state.connecting,
      qrCode: state.qrCode,
      phoneNumber: state.phoneNumber,
      lastError: state.lastError,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/whatsapp/status ─────────────────────────────────
// Returns current connection state + QR code data URL if available
router.get('/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const state = getWhatsAppState();
    return res.json({
      connected: state.connected,
      connecting: state.connecting,
      qrCode: state.qrCode,        // base64 PNG data URL for <img src>
      phoneNumber: state.phoneNumber,
      lastError: state.lastError,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/whatsapp/connect ───────────────────────────────
// Initiates WA connection / restarts if disconnected
router.post('/connect', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const current = getWhatsAppState();
    if (current.connected) {
      return res.json({ success: true, message: 'Already connected', phoneNumber: current.phoneNumber });
    }

    // Start in background so API returns immediately
    connectWhatsApp().catch(console.error);

    // Give it 1.5s to generate QR or connect
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const newState = getWhatsAppState();
    return res.json({
      success: true,
      message: newState.connected
        ? 'Connected successfully'
        : newState.qrCode
        ? 'QR code generated — scan with WhatsApp'
        : 'Connecting...',
      connected: newState.connected,
      connecting: newState.connecting,
      qrCode: newState.qrCode,
      phoneNumber: newState.phoneNumber,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/whatsapp/reconnect ─────────────────────────────
// Forces socket reset to generate fresh QR code
router.post('/reconnect', async (_req: Request, res: Response): Promise<any> => {
  try {
    reconnectWhatsApp().catch(console.error);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const newState = getWhatsAppState();
    return res.json({
      success: true,
      message: 'Reconnected — fresh QR generated',
      connected: newState.connected,
      connecting: newState.connecting,
      qrCode: newState.qrCode,
      phoneNumber: newState.phoneNumber,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/whatsapp/disconnect ────────────────────────────
// Logs out and clears session files
router.post('/disconnect', async (_req: Request, res: Response): Promise<any> => {
  try {
    await disconnectWhatsApp();
    return res.json({ success: true, message: 'WhatsApp disconnected and session cleared.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/whatsapp/test ──────────────────────────────────
// Sends a test text message to verify connection
router.post('/test', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required.' });
    }

    const state = getWhatsAppState();
    if (!state.connected) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp not connected. Scan QR code first.',
      });
    }

    const result = await sendWhatsAppText(
      phone,
      `✅ *RWA Billing System - Test Message*\n\nYeh test message hai Resident Welfare Association billing system se.\nAgar yeh message mil gaya hai to WhatsApp integration bilkul sahi kaam kar rahi hai! 🎉\n\nTime: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`
    );

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
