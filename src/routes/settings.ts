import { Router, Response } from 'express';
import { prisma } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../utils/logger';
import path from 'path';
import fs from 'fs';

const router = Router();

// GET /api/settings
router.get('/', async (_req, res): Promise<any> => {
  try {
    let settings = await prisma.associationSettings.findFirst();
    if (!settings) {
      settings = await prisma.associationSettings.create({
        data: {
          id: 'default-settings',
          organizationName: 'Resident Welfare Association',
          address: 'Central Community Center, Block B, Sector G-11',
          contactNumber: '+92 51 9260100',
          currency: 'Rs.',
          defaultDueDay: 10,
          challanFooter: 'Please pay before the 10th to avoid service interruptions.',
          receiptFooter: 'Thank you for your timely contribution towards our community.',
          challanCopies: 1,
          logoUrl: null,
        } as any,
      });
    }

    return res.json(settings);
  } catch (error) {
    console.error('Fetch settings error:', error);
    return res.status(500).json({ error: 'Failed to retrieve settings' });
  }
});

// PUT /api/settings (Admin only)
router.put('/', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const {
      organizationName,
      address,
      contactNumber,
      currency,
      defaultDueDay,
      challanFooter,
      receiptFooter,
      challanCopies,
      logoUrl,
      whatsappSenderNumber,
      whatsappAccessToken,
      whatsappPhoneNumberId,
    } = req.body;

    const updateData: any = {
      organizationName,
      address,
      contactNumber,
      currency,
      defaultDueDay: defaultDueDay !== undefined ? Number(defaultDueDay) : undefined,
      challanFooter,
      receiptFooter,
    };

    if (challanCopies !== undefined) {
      updateData.challanCopies = Math.max(1, Math.min(3, Number(challanCopies) || 1));
    }
    if (logoUrl !== undefined) {
      updateData.logoUrl = logoUrl;
    }
    if (whatsappSenderNumber !== undefined) {
      updateData.whatsappSenderNumber = whatsappSenderNumber;
    }
    if (whatsappAccessToken !== undefined) {
      updateData.whatsappAccessToken = whatsappAccessToken;
    }
    if (whatsappPhoneNumberId !== undefined) {
      updateData.whatsappPhoneNumberId = whatsappPhoneNumberId;
    }

    const settings = await prisma.associationSettings.upsert({
      where: { id: 'default-settings' },
      update: updateData,
      create: {
        id: 'default-settings',
        organizationName: organizationName || 'Resident Welfare Association',
        address: address || 'Central Community Center, Block B, Sector G-11',
        contactNumber: contactNumber || '+92 51 9260100',
        currency: currency || 'Rs.',
        defaultDueDay: Number(defaultDueDay) || 10,
        challanFooter: challanFooter || 'Please pay before the 10th to avoid service interruptions.',
        receiptFooter: receiptFooter || 'Thank you for your timely contribution towards our community.',
        challanCopies: Number(challanCopies) || 1,
        logoUrl: logoUrl || null,
        whatsappSenderNumber: whatsappSenderNumber || '+92 300 1234567',
        whatsappAccessToken: whatsappAccessToken || null,
        whatsappPhoneNumberId: whatsappPhoneNumberId || null,
      } as any,
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: 'ADMIN',
      action: 'Settings Updated',
      module: 'Settings',
      description: 'System configuration and WhatsApp settings updated',
      ipAddress: req.ip,
    });

    return res.json(settings);
  } catch (error) {
    console.error('Update settings error:', error);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
});

// POST /api/settings/test-whatsapp (Admin only)
router.post('/test-whatsapp', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { recipientPhone } = req.body;
    if (!recipientPhone) {
      return res.status(400).json({ error: 'Recipient phone number is required.' });
    }

    const { sendChallanViaWhatsApp } = await import('../utils/whatsappService');
    const { generateChallanPdfBuffer } = await import('../utils/serverPdfGenerator');

    const settings = await prisma.associationSettings.findFirst();

    const pdfBuffer = await generateChallanPdfBuffer(
      {
        id: 'test-preview',
        challanNumber: 'TEST-CH-001',
        memberId: 'RWA-TEST-001',
        memberName: 'Test Member',
        houseNumber: 'House 1',
        address: settings?.address || 'Community Center',
        month: 'Test Month',
        dueDate: new Date().toISOString().split('T')[0],
        totalAmount: 2500,
        paidAmount: 0,
        balance: 2500,
        status: 'Unpaid',
      },
      {
        fullName: 'Test Member',
        contactNumber: recipientPhone,
        address: 'Sector B',
      },
      {
        organizationName: settings?.organizationName || 'Resident Welfare Association',
        address: settings?.address || 'Central Community Center',
        contactNumber: settings?.contactNumber || '+92 51 9260100',
        logoUrl: settings?.logoUrl,
      }
    );

    const result = await sendChallanViaWhatsApp({
      recipientPhone,
      pdfBuffer,
      challanNumber: 'TEST-CH-001',
      memberName: 'Test Member',
      billingMonth: 'Current Month',
      totalAmount: 2500,
      dueDate: new Date().toISOString().split('T')[0],
    });

    return res.json(result);
  } catch (err: any) {
    console.error('Test whatsapp error:', err);
    return res.status(500).json({ error: err.message || 'Failed to send test message' });
  }
});

// POST /api/settings/upload-logo (Admin only)
router.post('/upload-logo', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { imageBase64, filename } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Valid image payload is required' });
    }

    // Match data URI scheme: data:image/(png|jpeg|jpg|webp);base64,...
    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let mimeType = 'image/png';
    let base64Data = imageBase64;

    if (matches && matches.length === 3) {
      mimeType = matches[1].toLowerCase();
      base64Data = matches[2];
    }

    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedMimeTypes.includes(mimeType)) {
      return res.status(400).json({
        error: 'Invalid file format. Allowed image formats: PNG, JPG/JPEG, WEBP.',
      });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const maxSize = 2 * 1024 * 1024; // 2 MB
    if (buffer.length > maxSize) {
      return res.status(400).json({
        error: 'Image file size exceeds maximum recommended limit of 2 MB.',
      });
    }

    let extension = 'png';
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') extension = 'jpg';
    else if (mimeType === 'image/webp') extension = 'webp';

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const uniqueName = `logo_${Date.now()}.${extension}`;
    const filePath = path.join(uploadsDir, uniqueName);

    fs.writeFileSync(filePath, buffer);
    const logoUrl = `/uploads/${uniqueName}`;

    // Update settings in database
    const settings = await prisma.associationSettings.upsert({
      where: { id: 'default-settings' },
      update: { logoUrl } as any,
      create: {
        id: 'default-settings',
        organizationName: 'Resident Welfare Association',
        logoUrl,
      } as any,
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: 'ADMIN',
      action: 'Logo Uploaded',
      module: 'Settings',
      description: `Official association logo updated (${uniqueName})`,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      logoUrl,
      settings,
    });
  } catch (error: any) {
    console.error('Upload logo error:', error);
    return res.status(500).json({ error: error.message || 'Failed to upload logo' });
  }
});

// DELETE /api/settings/logo (Admin only)
router.delete('/logo', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const current = await prisma.associationSettings.findFirst();
    if (current?.logoUrl) {
      const existingFile = path.join(process.cwd(), current.logoUrl.replace(/^\//, ''));
      if (fs.existsSync(existingFile)) {
        try {
          fs.unlinkSync(existingFile);
        } catch (e) {
          console.warn('Failed to delete old logo file:', e);
        }
      }
    }

    const settings = await prisma.associationSettings.upsert({
      where: { id: 'default-settings' },
      update: { logoUrl: null } as any,
      create: {
        id: 'default-settings',
        organizationName: 'Resident Welfare Association',
        logoUrl: null,
      } as any,
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: 'ADMIN',
      action: 'Logo Removed',
      module: 'Settings',
      description: 'Official association logo removed from document templates',
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      logoUrl: null,
      settings,
    });
  } catch (error: any) {
    console.error('Delete logo error:', error);
    return res.status(500).json({ error: error.message || 'Failed to remove logo' });
  }
});

export default router;

