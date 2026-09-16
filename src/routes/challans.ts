import { Router, Response } from 'express';
import { prisma } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../utils/logger';
import { generateChallanPdfBuffer } from '../utils/serverPdfGenerator';
import { sendChallanViaWhatsApp, normalizePhoneNumber, isWhatsAppConfigured } from '../utils/whatsappService';
import { sendChallanViaBaileys, getWhatsAppState } from '../utils/baileysBridge';

const router = Router();

// Month name helper to month key
function getMonthKey(monthName: string, year: number): string {
  const m = monthName.toLowerCase();
  let monthNum = '01';
  if (m.includes('jan')) monthNum = '01';
  else if (m.includes('feb')) monthNum = '02';
  else if (m.includes('mar')) monthNum = '03';
  else if (m.includes('apr')) monthNum = '04';
  else if (m.includes('may')) monthNum = '05';
  else if (m.includes('jun')) monthNum = '06';
  else if (m.includes('jul')) monthNum = '07';
  else if (m.includes('aug')) monthNum = '08';
  else if (m.includes('sep')) monthNum = '09';
  else if (m.includes('oct')) monthNum = '10';
  else if (m.includes('nov')) monthNum = '11';
  else if (m.includes('dec')) monthNum = '12';

  return `${year}-${monthNum}`;
}

// GET /api/challans
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { month, year, status, memberId } = req.query;

    const where: any = {};
    if (month) where.month = String(month);
    if (year) where.year = Number(year);
    if (status) where.status = String(status);

    if (memberId) {
      const member = await prisma.member.findFirst({
        where: { OR: [{ id: String(memberId) }, { memberCode: String(memberId) }] },
      });
      if (member) {
        where.memberId = member.id;
      }
    }

    // Role check: if MEMBER, restrict to their own challans
    if (req.user?.role === 'MEMBER' && req.user.memberId) {
      where.memberId = req.user.memberId;
    }

    const challans = await prisma.challan.findMany({
      where,
      include: {
        member: {
          select: {
            memberCode: true,
            fullName: true,
            houseNumber: true,
            address: true,
            contactNumber: true,
            plotNumber: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { challanNumber: 'desc' }],
    });

    const formatted = challans.map((c) => ({
      id: c.id,
      challanNumber: c.challanNumber,
      memberId: c.member.memberCode,
      memberName: c.member.fullName,
      houseNumber: c.member.houseNumber,
      address: c.member.address,
      contactNumber: c.member.contactNumber,
      month: c.month,
      monthKey: c.monthKey,
      year: c.year,
      monthName: c.month.split(' ')[0],
      baseAmount: c.baseAmount,
      monthlyAmount: c.baseAmount,
      monthlyDueAmount: c.baseAmount,
      arrearsAmount: c.arrearsAmount,
      previousDues: c.arrearsAmount,
      totalAmount: c.totalAmount,
      totalOutstanding: c.totalAmount,
      totalPayable: c.totalAmount,
      paidAmount: c.paidAmount,
      balance: c.balance,
      dueDate: c.dueDate,
      status: c.status,
      generatedDate: c.generatedDate,
      whatsappStatus: c.whatsappStatus || 'PENDING',
      whatsappSentAt: c.whatsappSentAt ? c.whatsappSentAt.toISOString() : null,
      whatsappMessageId: c.whatsappMessageId,
      whatsappError: c.whatsappError,
      createdAt: c.createdAt ? c.createdAt.toISOString() : undefined,
      updatedAt: c.updatedAt ? c.updatedAt.toISOString() : undefined,
    }));

    return res.json(formatted);
  } catch (error) {
    console.error('Fetch challans error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve challans' });
  }
});

// GET /api/challans/:id
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const challan = await prisma.challan.findFirst({
      where: { OR: [{ id }, { challanNumber: id }] },
      include: {
        member: true,
        allocations: {
          include: {
            payment: true,
          },
        },
      },
    });

    if (!challan) {
      return res.status(404).json({ success: false, message: 'Challan not found.' });
    }

    // Member access restriction
    if (req.user?.role === 'MEMBER' && req.user.memberId && req.user.memberId !== challan.memberId) {
      return res.status(403).json({ success: false, message: 'Access denied to this challan' });
    }

    return res.json({
      id: challan.id,
      challanNumber: challan.challanNumber,
      memberId: challan.member.memberCode,
      memberName: challan.member.fullName,
      houseNumber: challan.member.houseNumber,
      address: challan.member.address,
      contactNumber: challan.member.contactNumber,
      month: challan.month,
      monthKey: challan.monthKey,
      year: challan.year,
      monthName: challan.month.split(' ')[0],
      baseAmount: challan.baseAmount,
      monthlyAmount: challan.baseAmount,
      monthlyDueAmount: challan.baseAmount,
      arrearsAmount: challan.arrearsAmount,
      previousDues: challan.arrearsAmount,
      totalAmount: challan.totalAmount,
      totalOutstanding: challan.totalAmount,
      totalPayable: challan.totalAmount,
      paidAmount: challan.paidAmount,
      balance: challan.balance,
      dueDate: challan.dueDate,
      status: challan.status,
      generatedDate: challan.generatedDate,
      whatsappStatus: challan.whatsappStatus || 'PENDING',
      whatsappSentAt: challan.whatsappSentAt ? challan.whatsappSentAt.toISOString() : null,
      whatsappMessageId: challan.whatsappMessageId,
      whatsappError: challan.whatsappError,
      allocations: challan.allocations.map((a) => ({
        id: a.id,
        receiptNumber: a.payment.receiptNumber,
        paymentDate: a.payment.paymentDate,
        amount: a.allocatedAmount,
        paymentMethod: a.payment.paymentMethod,
      })),
    });
  } catch (error) {
    console.error('Fetch challan error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve challan details' });
  }
});

// POST /api/challans/generate (Admin only)
router.post('/generate', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { month, year, dueDate, target, memberIds } = req.body;

    if (!month || !year || !dueDate) {
      return res.status(400).json({ success: false, message: 'Month, year, and dueDate are required' });
    }

    const monthKey = getMonthKey(month, Number(year));
    const fullMonthName = `${month} ${year}`;

    // Target members
    let membersToBill = [];
    if (target === 'all') {
      membersToBill = await prisma.member.findMany({
        where: { status: 'Active' },
      });
    } else {
      membersToBill = await prisma.member.findMany({
        where: {
          status: 'Active',
          OR: [
            { id: { in: memberIds || [] } },
            { memberCode: { in: memberIds || [] } },
          ],
        },
      });
    }

    if (membersToBill.length === 0) {
      return res.status(400).json({ success: false, message: 'No active members selected for challan generation' });
    }

    const currentTotalChallans = await prisma.challan.count();

    // 1. Execute transactional creation in PostgreSQL
    let duplicatesSkippedCount = 0;
    const { createdChallans, skippedMembers } = await prisma.$transaction(async (tx) => {
      const generatedList = [];
      const skippedList = [];
      let counter = currentTotalChallans;

      for (const member of membersToBill) {
        // Duplicate Protection: Check if challan already exists for this member & month
        const existing = await tx.challan.findFirst({
          where: {
            memberId: member.id,
            monthKey,
          },
        });

        if (existing) {
          skippedList.push(member);
          continue; // Skip already billed member for this month
        }

        counter++;
        const serial = String(counter).padStart(3, '0');
        const challanNumber = `CH-${year}-${month.substring(0, 3).toUpperCase()}-${serial}`;

        // Compute arrears dynamically: sum of all unpaid/partial balances from previous challans
        const previousChallans = await tx.challan.findMany({
          where: {
            memberId: member.id,
            monthKey: { lt: monthKey },
            status: { in: ['Unpaid', 'Partial Paid'] },
          },
        });

        const arrearsAmount = previousChallans.reduce((sum, c) => sum + c.balance, 0);
        const baseAmount = member.monthlyDueAmount;
        const totalAmount = baseAmount + arrearsAmount;

        const created = await tx.challan.create({
          data: {
            challanNumber,
            memberId: member.id,
            month: fullMonthName,
            monthKey,
            year: Number(year),
            dueDate,
            baseAmount,
            arrearsAmount,
            totalAmount,
            paidAmount: 0,
            balance: totalAmount,
            status: 'Unpaid',
            generatedDate: new Date().toISOString().split('T')[0],
            whatsappStatus: 'PENDING',
          },
          include: {
            member: true,
          },
        });

        generatedList.push(created);
      }

      return { createdChallans: generatedList, skippedMembers: skippedList };
    });

    duplicatesSkippedCount = skippedMembers.length;

    if (createdChallans.length === 0) {
      return res.json({
        success: true,
        createdCount: 0,
        duplicatesSkippedCount,
        sentCount: 0,
        failedCount: 0,
        message: 'All selected members already have challans for this month. Duplicates skipped.',
        createdChallans: [],
      });
    }

    // 2. Fetch Association Settings for branded PDF rendering
    const settings = (await prisma.associationSettings.findFirst({
      where: { id: 'default-settings' },
    })) || {
      organizationName: 'Resident Welfare Association',
      address: 'Central Community Center, Block B, Sector G-11',
      contactNumber: '+92 51 9260100',
      currency: 'Rs.',
      logoUrl: null,
    };

    // 3. Non-blocking WhatsApp background dispatch & Activity logging
    const baileysState = getWhatsAppState();
    const useBaileys = baileysState.connected;
    const isMetaConfigured = isWhatsAppConfigured();
    const isWaConnected = useBaileys || isMetaConfigured;

    // Asynchronous background dispatch function
    const dispatchBackgroundWhatsApp = async () => {
      let sent = 0;
      let failed = 0;

      if (!isWaConnected) {
        const errorReason = 'WhatsApp not connected. Scan QR in Settings to send notifications.';
        const challanIds = createdChallans.map((c) => c.id);
        if (challanIds.length > 0) {
          await prisma.challan.updateMany({
            where: { id: { in: challanIds } },
            data: { whatsappStatus: 'FAILED', whatsappError: errorReason },
          });
        }
        return;
      }

      await Promise.all(
        createdChallans.map(async (ch) => {
          const member = ch.member;
          const normalizedPhone = normalizePhoneNumber(member.contactNumber);

          if (!normalizedPhone) {
            await prisma.challan.update({
              where: { id: ch.id },
              data: { whatsappStatus: 'FAILED', whatsappError: 'Invalid or missing WhatsApp number.' },
            }).catch(() => {});
            return;
          }

          try {
            const pdfBuffer = await generateChallanPdfBuffer(
              {
                id: ch.id,
                challanNumber: ch.challanNumber,
                memberId: member.memberCode,
                memberName: member.fullName,
                houseNumber: member.houseNumber,
                address: member.address,
                month: ch.month,
                dueDate: ch.dueDate,
                totalAmount: ch.totalAmount,
                paidAmount: ch.paidAmount,
                balance: ch.balance,
                status: ch.status,
              },
              {
                fullName: member.fullName,
                contactNumber: member.contactNumber,
                address: member.address,
                plotNumber: member.plotNumber || undefined,
                floors: member.plotNumber ? member.plotNumber.split(',').map((s) => s.trim()) : undefined,
              },
              {
                organizationName: settings.organizationName,
                address: settings.address,
                contactNumber: settings.contactNumber,
                logoUrl: settings.logoUrl,
              }
            );

            let waResult;
            if (useBaileys) {
              waResult = await sendChallanViaBaileys({
                recipientPhone: normalizedPhone,
                pdfBuffer,
                challanNumber: ch.challanNumber,
                memberName: member.fullName,
                billingMonth: ch.month,
                totalAmount: ch.totalAmount,
                dueDate: ch.dueDate,
                associationName: settings.organizationName,
              });
            } else {
              waResult = await sendChallanViaWhatsApp({
                recipientPhone: normalizedPhone,
                pdfBuffer,
                challanNumber: ch.challanNumber,
                memberName: member.fullName,
                billingMonth: ch.month,
                totalAmount: ch.totalAmount,
                dueDate: ch.dueDate,
              });
            }

            if (waResult.success && waResult.messageId) {
              await prisma.challan.update({
                where: { id: ch.id },
                data: {
                  whatsappStatus: 'SENT',
                  whatsappSentAt: new Date(),
                  whatsappMessageId: waResult.messageId,
                  whatsappError: null,
                },
              }).catch(() => {});
              sent++;
            } else {
              await prisma.challan.update({
                where: { id: ch.id },
                data: {
                  whatsappStatus: 'FAILED',
                  whatsappError: waResult.error || 'WhatsApp delivery failed.',
                },
              }).catch(() => {});
              failed++;
            }
          } catch (err: any) {
            await prisma.challan.update({
              where: { id: ch.id },
              data: {
                whatsappStatus: 'FAILED',
                whatsappError: err?.message || 'Server error sending WhatsApp',
              },
            }).catch(() => {});
            failed++;
          }
        })
      );

      logActivity({
        user: req.user?.fullName || 'Admin',
        role: req.user?.role || 'ADMIN',
        action: 'Challans Generated & Dispatched',
        module: 'Billing',
        description: `Generated ${createdChallans.length} challans for ${fullMonthName} (WhatsApp Sent: ${sent}, Failed: ${failed}, Duplicates Skipped: ${duplicatesSkippedCount})`,
        ipAddress: req.ip,
      }).catch(() => {});
    };

    // Run WhatsApp dispatch asynchronously in background
    dispatchBackgroundWhatsApp().catch((err) => console.error('Background WhatsApp dispatch error:', err));

    return res.status(201).json({
      success: true,
      count: createdChallans.length,
      createdCount: createdChallans.length,
      duplicatesSkippedCount,
      sentCount: isWaConnected ? createdChallans.length : 0,
      failedCount: 0,
      challans: createdChallans.map((c) => ({
        id: c.id,
        challanNumber: c.challanNumber,
        memberId: c.member.memberCode,
        memberName: c.member.fullName,
        houseNumber: c.member.houseNumber,
        address: c.member.address,
        month: c.month,
        monthKey: c.monthKey,
        year: c.year,
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        balance: c.balance,
        dueDate: c.dueDate,
        status: c.status,
        whatsappStatus: c.whatsappStatus,
        whatsappSentAt: c.whatsappSentAt ? c.whatsappSentAt.toISOString() : null,
        whatsappMessageId: c.whatsappMessageId,
        whatsappError: c.whatsappError,
      })),
    });
  } catch (error: any) {
    console.error('Challan generation error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to generate challans' });
  }
});

// POST /api/challans/:id/send-whatsapp
// Resend / Share action: generates fresh PDF and sends via WhatsApp Cloud API to ONLY that member
router.post('/:id/send-whatsapp', authenticateToken, requireRole(['ADMIN', 'COLLECTION_STAFF']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const challan = await prisma.challan.findFirst({
      where: { OR: [{ id }, { challanNumber: id }] },
      include: { member: true },
    });

    if (!challan) {
      return res.status(404).json({
        success: false,
        message: 'Challan not found.',
      });
    }

    const member = challan.member;
    const normalizedPhone = normalizePhoneNumber(member.contactNumber);

    if (!normalizedPhone) {
      const errorMsg = 'Invalid or missing member WhatsApp number.';
      await prisma.challan.update({
        where: { id: challan.id },
        data: {
          whatsappStatus: 'FAILED',
          whatsappError: errorMsg,
        },
      });

      return res.status(400).json({
        success: false,
        message: `WhatsApp delivery failed: ${errorMsg}`,
        error: `WhatsApp delivery failed: ${errorMsg}`,
        whatsappStatus: 'FAILED',
      });
    }

    // Check if WhatsApp configuration exists
    if (!isWhatsAppConfigured()) {
      const errorMsg = 'WhatsApp Business API is not configured.';
      await prisma.challan.update({
        where: { id: challan.id },
        data: {
          whatsappStatus: 'FAILED',
          whatsappError: errorMsg,
        },
      });

      return res.status(503).json({
        success: false,
        message: `WhatsApp delivery failed: ${errorMsg}`,
        error: `WhatsApp delivery failed: ${errorMsg}`,
        whatsappStatus: 'FAILED',
      });
    }

    // Mark PENDING in DB while sending
    await prisma.challan.update({
      where: { id: challan.id },
      data: { whatsappStatus: 'PENDING' },
    });

    const settings = (await prisma.associationSettings.findFirst({
      where: { id: 'default-settings' },
    })) || {
      organizationName: 'Resident Welfare Association',
      address: 'Central Community Center, Block B, Sector G-11',
      contactNumber: '+92 51 9260100',
      currency: 'Rs.',
      logoUrl: null,
    };

    // Generate Server-Side PDF
    const pdfBuffer = await generateChallanPdfBuffer(
      {
        id: challan.id,
        challanNumber: challan.challanNumber,
        memberId: member.memberCode,
        memberName: member.fullName,
        houseNumber: member.houseNumber,
        address: member.address,
        month: challan.month,
        dueDate: challan.dueDate,
        totalAmount: challan.totalAmount,
        paidAmount: challan.paidAmount,
        balance: challan.balance,
        status: challan.status,
      },
      {
        fullName: member.fullName,
        contactNumber: member.contactNumber,
        address: member.address,
        plotNumber: member.plotNumber || undefined,
        floors: member.plotNumber ? member.plotNumber.split(',').map((s) => s.trim()) : undefined,
      },
      {
        organizationName: settings.organizationName,
        address: settings.address,
        contactNumber: settings.contactNumber,
        logoUrl: settings.logoUrl,
      }
    );

    // Send via Baileys (preferred) or Meta Cloud API (fallback)
    const baileysState = getWhatsAppState();
    let waResult;
    if (baileysState.connected) {
      waResult = await sendChallanViaBaileys({
        recipientPhone: normalizedPhone,
        pdfBuffer,
        challanNumber: challan.challanNumber,
        memberName: member.fullName,
        billingMonth: challan.month,
        totalAmount: challan.totalAmount,
        dueDate: challan.dueDate,
        associationName: settings.organizationName,
      });
    } else {
      waResult = await sendChallanViaWhatsApp({
        recipientPhone: normalizedPhone,
        pdfBuffer,
        challanNumber: challan.challanNumber,
        memberName: member.fullName,
        billingMonth: challan.month,
        totalAmount: challan.totalAmount,
        dueDate: challan.dueDate,
      });
    }

    if (waResult.success && waResult.messageId) {
      const updated = await prisma.challan.update({
        where: { id: challan.id },
        data: {
          whatsappStatus: 'SENT',
          whatsappSentAt: new Date(),
          whatsappMessageId: waResult.messageId,
          whatsappError: null,
        },
        include: { member: true },
      });

      await logActivity({
        user: req.user?.fullName || 'Staff',
        role: req.user?.role || 'COLLECTION_STAFF',
        action: 'Challan WhatsApp Sent',
        module: 'Billing',
        description: `Sent challan ${challan.challanNumber} (${challan.month}) to ${member.fullName} (${normalizedPhone}) via WhatsApp`,
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        message: `Challan sent successfully to ${member.fullName}.`,
        memberName: member.fullName,
        whatsappStatus: 'SENT',
        whatsappSentAt: updated.whatsappSentAt,
        whatsappMessageId: updated.whatsappMessageId,
        challan: {
          id: updated.id,
          challanNumber: updated.challanNumber,
          memberName: member.fullName,
          whatsappStatus: updated.whatsappStatus,
          whatsappSentAt: updated.whatsappSentAt?.toISOString(),
          whatsappMessageId: updated.whatsappMessageId,
        },
      });
    } else {
      const errorMsg = waResult.error || 'WhatsApp delivery failed.';
      const updated = await prisma.challan.update({
        where: { id: challan.id },
        data: {
          whatsappStatus: 'FAILED',
          whatsappError: errorMsg,
        },
        include: { member: true },
      });

      return res.status(502).json({
        success: false,
        message: `WhatsApp delivery failed: ${errorMsg}`,
        error: `WhatsApp delivery failed: ${errorMsg}`,
        whatsappStatus: 'FAILED',
        whatsappError: errorMsg,
        challan: {
          id: updated.id,
          challanNumber: updated.challanNumber,
          memberName: member.fullName,
          whatsappStatus: updated.whatsappStatus,
          whatsappError: updated.whatsappError,
        },
      });
    }
  } catch (error: any) {
    console.error('Send single WhatsApp error:', error);
    return res.status(500).json({
      success: false,
      message: 'WhatsApp delivery failed.',
      error: error.message || 'Failed to send challan via WhatsApp',
    });
  }
});

// DELETE /api/challans/:id (Admin only)
// Enforces strict financial rule: only unpaid challans with zero payments and zero allocations can be deleted
router.delete('/:id', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const challan = await prisma.challan.findFirst({
      where: { OR: [{ id }, { challanNumber: id }] },
      include: {
        member: {
          select: {
            fullName: true,
            memberCode: true,
          },
        },
        allocations: true,
      },
    });

    if (!challan) {
      return res.status(404).json({ success: false, message: 'Challan not found.' });
    }

    // Safety checks: Zero payments and zero allocations required
    const hasAllocations = challan.allocations && challan.allocations.length > 0;
    const hasPaidAmount = challan.paidAmount > 0;

    if (hasPaidAmount || hasAllocations) {
      return res.status(400).json({
        success: false,
        message: 'This challan has payment history and cannot be deleted.',
      });
    }

    // Permanently delete unpaid challan
    await prisma.challan.delete({
      where: { id: challan.id },
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: 'ADMIN',
      action: 'Challan Deleted',
      module: 'Billing',
      description: `Deleted unpaid challan ${challan.challanNumber} (${challan.month}) for ${challan.member.fullName} (${challan.member.memberCode})`,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: `Challan ${challan.challanNumber} was permanently deleted.`,
      id: challan.id,
      challanNumber: challan.challanNumber,
    });
  } catch (error: any) {
    console.error('Challan deletion error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to delete challan' });
  }
});

export default router;
