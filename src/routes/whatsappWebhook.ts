import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { logActivity } from '../utils/logger';

const router = Router();

/**
 * GET /api/whatsapp/webhook
 * Meta Webhook verification handshake.
 */
router.get('/webhook', (req: Request, res: Response): any => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'rwa_whatsapp_webhook_secret_2026';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp Webhook verified successfully.');
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ error: 'Webhook verification failed: Invalid verify token' });
});

/**
 * POST /api/whatsapp/webhook
 * Receives delivery updates from WhatsApp Cloud API:
 * sent, delivered, read, failed
 */
router.post('/webhook', async (req: Request, res: Response): Promise<any> => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      const entries = body.entry || [];

      for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
          const value = change.value;
          const statuses = value?.statuses || [];

          for (const statusObj of statuses) {
            const messageId = statusObj.id;
            const status = statusObj.status; // 'sent', 'delivered', 'read', 'failed'
            const timestamp = statusObj.timestamp;

            let dbStatus = 'SENT';
            if (status === 'delivered') dbStatus = 'DELIVERED';
            else if (status === 'read') dbStatus = 'READ';
            else if (status === 'failed') dbStatus = 'FAILED';
            else if (status === 'sent') dbStatus = 'SENT';

            const errorMessage = statusObj.errors?.[0]?.title || statusObj.errors?.[0]?.message || null;

            // Find matching challan by whatsappMessageId
            if (messageId) {
              const matchedChallan = await prisma.challan.findFirst({
                where: { whatsappMessageId: messageId },
                include: { member: true },
              });

              if (matchedChallan) {
                await prisma.challan.update({
                  where: { id: matchedChallan.id },
                  data: {
                    whatsappStatus: dbStatus,
                    whatsappError: errorMessage || matchedChallan.whatsappError,
                  },
                });

                await logActivity({
                  user: 'WhatsApp Webhook',
                  role: 'SYSTEM',
                  action: `WhatsApp ${dbStatus}`,
                  module: 'Billing',
                  description: `Status of challan ${matchedChallan.challanNumber} (${matchedChallan.member.fullName}) updated to ${dbStatus} via WhatsApp webhook`,
                });
              }
            }
          }
        }
      }

      return res.status(200).json({ status: 'EVENT_RECEIVED' });
    }

    return res.status(404).json({ error: 'Not a WhatsApp Business API event' });
  } catch (error: any) {
    console.error('WhatsApp Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error processing webhook' });
  }
});

export default router;
