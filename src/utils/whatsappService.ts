import dotenv from 'dotenv';

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppChallanPayload {
  recipientPhone: string;
  pdfBuffer: Buffer;
  challanNumber: string;
  memberName: string;
  billingMonth: string;
  totalAmount: number;
  dueDate: string;
}

/**
 * Normalizes contact numbers to standard E.164-like digits (without leading +).
 * Pakistani formats supported:
 * 03001234567   -> 923001234567
 * +923001234567 -> 923001234567
 * 00923001234567-> 923001234567
 * 3001234567    -> 923001234567
 * 923001234567  -> 923001234567
 */
export function normalizePhoneNumber(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;

  // Remove spaces, hyphens, brackets, dots, etc.
  let cleaned = String(rawPhone).trim().replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  // Remove leading +
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // If starts with 00, remove 00
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }

  // Pakistani 03xx (11 digits: e.g. 03001234567) -> 923001234567
  if (cleaned.startsWith('03') && cleaned.length === 11) {
    cleaned = '92' + cleaned.substring(1);
  } else if (cleaned.startsWith('3') && cleaned.length === 10) {
    // 3001234567 -> 923001234567
    cleaned = '92' + cleaned;
  }

  // Final length check: standard phone numbers are 10 to 15 digits
  if (/^\d{10,15}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

/**
 * Retrieves WhatsApp credentials dynamically from database settings first, falling back to .env.
 */
export async function getWhatsAppCredentials(): Promise<{
  accessToken: string;
  phoneNumberId: string;
  senderNumber: string;
  templateName?: string;
  apiVersion: string;
}> {
  dotenv.config();
  let dbSettings: any = null;
  try {
    const { prisma } = await import('../db');
    dbSettings = await prisma.associationSettings.findFirst();
  } catch {
    // ignore
  }

  const accessToken =
    dbSettings?.whatsappAccessToken?.trim() ||
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() ||
    'sandbox';

  const phoneNumberId =
    dbSettings?.whatsappPhoneNumberId?.trim() ||
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    '1092837482910';

  const senderNumber =
    dbSettings?.whatsappSenderNumber?.trim() ||
    process.env.WHATSAPP_SENDER_NUMBER?.trim() ||
    dbSettings?.contactNumber?.trim() ||
    '+92 300 1234567';

  const templateName =
    process.env.WHATSAPP_TEMPLATE_NAME?.trim();

  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0';

  return {
    accessToken,
    phoneNumberId,
    senderNumber,
    templateName,
    apiVersion,
  };
}

/**
 * Checks whether WhatsApp Business Cloud API is configured.
 */
export function isWhatsAppConfigured(): boolean {
  dotenv.config();
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) return false;
  const t = token.toLowerCase();
  if (t === 'sandbox' || t === 'demo' || t === 'test') return false;
  return true;
}

/**
 * Uploads a PDF Buffer to Meta WhatsApp Cloud API media endpoint.
 */
async function uploadMediaToWhatsApp(
  pdfBuffer: Buffer,
  filename: string,
  phoneNumberId: string,
  accessToken: string,
  apiVersion: string
): Promise<string> {
  const mediaUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`;

  // Create form data using standard Blob and FormData
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', 'application/pdf');

  // Convert Buffer to Uint8Array for Blob
  const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
  formData.append('file', blob, filename);

  const res = await fetch(mediaUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const data = (await res.json()) as any;
  if (!res.ok || !data?.id) {
    const errMsg = data?.error?.message || `Failed to upload media (HTTP ${res.status})`;
    throw new Error(errMsg);
  }

  return data.id;
}

/**
 * Dispatches a single member's challan PDF to their WhatsApp number using the official WhatsApp Business Cloud API.
 * Never throws an uncaught error; always returns a structured result.
 */
export async function sendChallanViaWhatsApp(
  payload: WhatsAppChallanPayload
): Promise<WhatsAppSendResult> {
  const {
    recipientPhone,
    pdfBuffer,
    challanNumber,
    memberName,
    billingMonth,
    totalAmount,
    dueDate,
  } = payload;

  const normalizedPhone = normalizePhoneNumber(recipientPhone);
  if (!normalizedPhone) {
    return {
      success: false,
      error: 'Invalid or missing WhatsApp number.',
    };
  }

  const credentials = await getWhatsAppCredentials();
  const { accessToken, phoneNumberId, templateName, apiVersion } = credentials;

  // Developer Sandbox / Demo Mode support (automatic when token is sandbox, demo, test, or local fallback)
  if (
    !accessToken ||
    accessToken.toLowerCase() === 'sandbox' ||
    accessToken.toLowerCase() === 'demo' ||
    accessToken.toLowerCase() === 'test'
  ) {
    const mockMessageId = `wamid.HBgM${Date.now()}_DEMO_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    return {
      success: true,
      messageId: mockMessageId,
    };
  }

  const safeFilename = `${challanNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  try {
    // 1. Upload PDF Buffer to Meta Media Endpoint
    const mediaId = await uploadMediaToWhatsApp(
      pdfBuffer,
      safeFilename,
      phoneNumberId,
      accessToken,
      apiVersion
    );

    const messagesUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    // 2. Prepare WhatsApp payload
    let requestBody: any = null;

    if (templateName) {
      // Send message using approved WhatsApp Template
      requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'document',
                  document: {
                    id: mediaId,
                    filename: safeFilename,
                  },
                },
              ],
            },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: memberName },
                { type: 'text', text: billingMonth },
                { type: 'text', text: challanNumber },
                { type: 'text', text: totalAmount.toLocaleString() },
                { type: 'text', text: dueDate },
              ],
            },
          ],
        },
      };
    } else {
      // Send direct document message with caption
      const caption = `Dear ${memberName},\nYour Resident Welfare Association challan for ${billingMonth} has been generated.\nChallan No: ${challanNumber}\nTotal Payable: Rs ${totalAmount.toLocaleString()}\nDue Date: ${dueDate}\n\nPlease find your challan attached.`;

      requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'document',
        document: {
          id: mediaId,
          caption,
          filename: safeFilename,
        },
      };
    }

    // 3. Send Message
    const msgRes = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const msgData = (await msgRes.json()) as any;

    if (!msgRes.ok || !msgData?.messages?.[0]?.id) {
      const errorMsg =
        msgData?.error?.message ||
        msgData?.error?.error_user_msg ||
        `WhatsApp API delivery error (HTTP ${msgRes.status})`;
      return {
        success: false,
        error: errorMsg,
      };
    }

    return {
      success: true,
      messageId: msgData.messages[0].id,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Unknown network error communicating with WhatsApp Cloud API';
    return {
      success: false,
      error: errorMsg,
    };
  }
}
