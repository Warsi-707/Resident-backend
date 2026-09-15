/**
 * Baileys WhatsApp Bridge
 * ========================
 * Free WhatsApp messaging via @whiskeysockets/baileys.
 * Works by scanning a QR code once → session persists in ./whatsapp_sessions/
 *
 * Flow:
 *  1. GET /api/whatsapp/status  → returns { connected, qr }
 *  2. If not connected, show QR image to admin
 *  3. Admin scans QR → connection established
 *  4. All challan sends go through this bridge automatically
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

// Session directory (outside src/ so it persists across restarts)
const SESSION_DIR = path.join(process.cwd(), 'whatsapp_sessions');

export interface BaileysState {
  connected: boolean;
  qrCode: string | null;           // base64 PNG data URL
  qrRaw: string | null;            // raw QR string for manual display
  phoneNumber: string | null;      // connected WA number
  lastError: string | null;
  connecting: boolean;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

let sock: any = null;
let baileysModule: any = null;
let storeModule: any = null;
let QRCode: any = null;

// In-memory state — shared via module singleton
const state: BaileysState = {
  connected: false,
  qrCode: null,
  qrRaw: null,
  phoneNumber: null,
  lastError: null,
  connecting: false,
};

export const baileysEvents = new EventEmitter();

// ─────────────────────────────────────────────────────────────
// Lazy-load Baileys (only available at runtime, not at build time)
// ─────────────────────────────────────────────────────────────
async function loadBaileys() {
  if (baileysModule) return baileysModule;
  try {
    // Dynamic import to avoid build-time failures
    baileysModule = await import('@whiskeysockets/baileys');
    QRCode = await import('qrcode');
    return baileysModule;
  } catch (err: any) {
    throw new Error(
      `Baileys library not installed. Run: npm install @whiskeysockets/baileys qrcode pino\nError: ${err.message}`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Connect / Reconnect
// ─────────────────────────────────────────────────────────────
export async function connectWhatsApp(): Promise<void> {
  if (state.connecting || state.connected) return;
  state.connecting = true;
  state.lastError = null;

  try {
    const B = await loadBaileys();

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state: authState, saveCreds } = await B.useMultiFileAuthState(SESSION_DIR);
    const logger = (await import('pino')).default({ level: 'silent' });

    sock = B.makeWASocket({
      auth: authState,
      logger,
      printQRInTerminal: false,
      browser: ['RWA Billing', 'Chrome', '120.0'],
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      retryRequestDelayMs: 2000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.default.toDataURL(qr, {
            width: 280,
            margin: 2,
            color: { dark: '#1a1a2e', light: '#ffffff' },
          });
          state.qrCode = qrDataUrl;
          state.qrRaw = qr;
          state.connected = false;
          state.connecting = true;
          baileysEvents.emit('qr', qrDataUrl);
          console.log('📱 [WhatsApp] QR code generated — scan with WhatsApp app');
        } catch (e) {
          console.error('[WhatsApp] QR generation error:', e);
        }
      }

      if (connection === 'open') {
        state.connected = true;
        state.connecting = false;
        state.qrCode = null;
        state.qrRaw = null;
        state.lastError = null;
        const jid = sock.user?.id || '';
        state.phoneNumber = jid.split(':')[0].replace('@', '').replace('s.whatsapp.net', '');
        baileysEvents.emit('connected', state.phoneNumber);
        console.log(`✅ [WhatsApp] Connected! Number: ${state.phoneNumber}`);
      }

      if (connection === 'close') {
        state.connected = false;
        state.connecting = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const reason = B.DisconnectReason;

        if (statusCode === reason.loggedOut) {
          console.log('🔴 [WhatsApp] Logged out — clearing session, scan QR again');
          state.lastError = 'Logged out. Please scan QR again.';
          state.phoneNumber = null;
          // Clear saved session so fresh QR is generated
          try {
            if (fs.existsSync(SESSION_DIR)) {
              fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            }
          } catch {}
          baileysEvents.emit('disconnected', 'logged_out');
        } else {
          const willReconnect = statusCode !== 401;
          console.log(`🟡 [WhatsApp] Disconnected (code: ${statusCode}). Will reconnect: ${willReconnect}`);
          state.lastError = `Disconnected (code: ${statusCode})`;
          baileysEvents.emit('disconnected', statusCode);
          if (willReconnect) {
            setTimeout(() => {
              state.connecting = false;
              connectWhatsApp();
            }, 5000);
          }
        }
      }
    });

    sock.ev.on('messages.upsert', () => {});

  } catch (err: any) {
    state.connecting = false;
    state.lastError = err.message;
    console.error('[WhatsApp] Connection error:', err.message);
    baileysEvents.emit('error', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Disconnect / Logout
// ─────────────────────────────────────────────────────────────
export async function disconnectWhatsApp(): Promise<void> {
  if (sock) {
    try {
      await sock.logout();
    } catch {}
    sock = null;
  }
  state.connected = false;
  state.connecting = false;
  state.qrCode = null;
  state.qrRaw = null;
  state.phoneNumber = null;

  // Clear session files
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
  } catch {}
  baileysEvents.emit('disconnected', 'manual');
}

// ─────────────────────────────────────────────────────────────
// Reconnect / Force New QR
// ─────────────────────────────────────────────────────────────
export async function reconnectWhatsApp(): Promise<void> {
  if (sock && !state.connected) {
    try {
      sock.end(undefined);
    } catch {}
    sock = null;
  }
  state.connecting = false;
  state.connected = false;
  state.qrCode = null;
  state.qrRaw = null;
  state.lastError = null;
  await connectWhatsApp();
}

// ─────────────────────────────────────────────────────────────
// Get current state
// ─────────────────────────────────────────────────────────────
export function getWhatsAppState(): BaileysState {
  return { ...state };
}

// ─────────────────────────────────────────────────────────────
// Normalize Pakistani phone numbers → WhatsApp JID format
// ─────────────────────────────────────────────────────────────
function normalizeToJID(rawPhone: string): string | null {
  if (!rawPhone) return null;
  let num = rawPhone.trim().replace(/[\s\-().+]/g, '');

  if (num.startsWith('00')) num = num.slice(2);
  if (num.startsWith('0') && num.length === 11) num = '92' + num.slice(1);
  if (num.startsWith('3') && num.length === 10) num = '92' + num;
  if (!/^\d{11,15}$/.test(num)) return null;

  return `${num}@s.whatsapp.net`;
}

// ─────────────────────────────────────────────────────────────
// Send WhatsApp text message (simple, no PDF)
// ─────────────────────────────────────────────────────────────
export async function sendWhatsAppText(
  phone: string,
  message: string
): Promise<SendResult> {
  if (!state.connected || !sock) {
    return { success: false, error: 'WhatsApp not connected. Please scan QR first.' };
  }

  const jid = normalizeToJID(phone);
  if (!jid) {
    return { success: false, error: `Invalid phone number: ${phone}` };
  }

  try {
    const result = await sock.sendMessage(jid, { text: message });
    return { success: true, messageId: result?.key?.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
// Send WhatsApp document (PDF buffer)
// ─────────────────────────────────────────────────────────────
export async function sendWhatsAppDocument(
  phone: string,
  pdfBuffer: Buffer,
  filename: string,
  caption: string
): Promise<SendResult> {
  if (!state.connected || !sock) {
    return { success: false, error: 'WhatsApp not connected. Please scan QR first.' };
  }

  const jid = normalizeToJID(phone);
  if (!jid) {
    return { success: false, error: `Invalid phone number: ${phone}` };
  }

  try {
    const result = await sock.sendMessage(jid, {
      document: pdfBuffer,
      mimetype: 'application/pdf',
      fileName: filename,
      caption,
    });
    return { success: true, messageId: result?.key?.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
// Send Challan (text message with challan details)
// ─────────────────────────────────────────────────────────────
export async function sendChallanViaBaileys(payload: {
  recipientPhone: string;
  pdfBuffer: Buffer;
  challanNumber: string;
  memberName: string;
  billingMonth: string;
  totalAmount: number;
  dueDate: string;
  associationName?: string;
}): Promise<SendResult> {
  const {
    recipientPhone,
    pdfBuffer,
    challanNumber,
    memberName,
    billingMonth,
    totalAmount,
    dueDate,
    associationName = 'Resident Welfare Association',
  } = payload;

  if (!state.connected || !sock) {
    return { success: false, error: 'WhatsApp not connected. Scan QR in Settings first.' };
  }

  const jid = normalizeToJID(recipientPhone);
  if (!jid) {
    return { success: false, error: `Invalid phone number: ${recipientPhone}` };
  }

  const caption =
    `🏘️ *${associationName}*\n\n` +
    `Assalam o Alaikum, *${memberName}*!\n\n` +
    `📋 *Challan # ${challanNumber}*\n` +
    `📅 Month: *${billingMonth}*\n` +
    `💰 Total Payable: *Rs. ${totalAmount.toLocaleString()}*\n` +
    `📆 Due Date: *${dueDate}*\n\n` +
    `Please pay before the due date to avoid service interruptions.\n` +
    `_Challan PDF attached above._`;

  const safeFilename = `Challan_${challanNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  try {
    // Send PDF document with caption
    const result = await sock.sendMessage(jid, {
      document: pdfBuffer,
      mimetype: 'application/pdf',
      fileName: safeFilename,
      caption,
    });
    return { success: true, messageId: result?.key?.id || `baileys_${Date.now()}` };
  } catch (err: any) {
    // Fallback: try text-only message if PDF fails
    try {
      const textResult = await sock.sendMessage(jid, { text: caption });
      return {
        success: true,
        messageId: textResult?.key?.id || `baileys_text_${Date.now()}`,
      };
    } catch (textErr: any) {
      return { success: false, error: textErr.message || err.message };
    }
  }
}
