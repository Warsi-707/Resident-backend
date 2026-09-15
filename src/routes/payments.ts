import { Router, Response } from 'express';
import { prisma } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../utils/logger';
import { getWhatsAppState, sendWhatsAppText, sendWhatsAppDocument } from '../utils/baileysBridge';
import { generateChallanPdfBuffer } from '../utils/serverPdfGenerator';
import { sendChallanViaWhatsApp } from '../utils/whatsappService';

const router = Router();

function getLocalDateString(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// GET /api/payments
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { memberId, status, paymentMethod, fromDate, toDate } = req.query;

    const where: any = {};
    if (status) {
      if (status === 'Valid') where.isVoid = false;
      else if (status === 'Voided') where.isVoid = true;
    }

    if (paymentMethod) {
      where.paymentMethod = String(paymentMethod);
    }

    if (fromDate || toDate) {
      where.paymentDate = {};
      if (fromDate) where.paymentDate.gte = String(fromDate);
      if (toDate) where.paymentDate.lte = String(toDate);
    }

    if (memberId) {
      const member = await prisma.member.findFirst({
        where: { OR: [{ id: String(memberId) }, { memberCode: String(memberId) }] },
      });
      if (member) {
        where.memberId = member.id;
      }
    }

    // Member access restriction: view own payments only
    if (req.user?.role === 'MEMBER' && req.user.memberId) {
      where.memberId = req.user.memberId;
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        member: {
          select: {
            memberCode: true,
            fullName: true,
            houseNumber: true,
          },
        },
        allocations: {
          include: {
            challan: {
              select: {
                challanNumber: true,
                month: true,
              },
            },
          },
        },
      },
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });

    const formatted = payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      paymentNumber: p.paymentNumber || p.receiptNumber,
      memberId: p.member.memberCode,
      memberName: p.member.fullName,
      houseNumber: p.member.houseNumber,
      paymentDate: p.paymentDate,
      amount: p.amount,
      paidAmount: p.amount,
      paymentType: p.paymentType as 'Full Paid' | 'Partial Paid',
      paymentMethod: p.paymentMethod as 'Cash' | 'Online',
      referenceNumber: p.referenceNumber,
      relevantMonth: p.relevantMonth,
      collectedBy: p.collectedByName,
      collectedByName: p.collectedByName,
      collectedByRole: p.collectedByRole,
      notes: p.notes || undefined,
      status: p.isVoid ? 'Voided' : 'Valid',
      isVoid: p.isVoid,
      voidReason: p.voidReason || undefined,
      voidedAt: p.voidedAt ? p.voidedAt.toISOString() : undefined,
      voidedBy: p.voidedBy || undefined,
      allocations: p.allocations.map((a) => ({
        id: a.id,
        challanNumber: a.challan.challanNumber,
        month: a.challan.month,
        amount: a.allocatedAmount,
      })),
      createdAt: p.createdAt ? p.createdAt.toISOString() : undefined,
    }));

    return res.json(formatted);
  } catch (error) {
    console.error('Fetch payments error:', error);
    return res.status(500).json({ error: 'Failed to retrieve payments' });
  }
});

// GET /api/payments/:id
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ id }, { receiptNumber: id }, { paymentNumber: id }],
      },
      include: {
        member: true,
        allocations: {
          include: {
            challan: true,
          },
        },
        receipt: true,
      },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    if (req.user?.role === 'MEMBER' && req.user.memberId && req.user.memberId !== payment.memberId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({
      id: payment.id,
      receiptNumber: payment.receiptNumber,
      paymentNumber: payment.paymentNumber,
      memberId: payment.member.memberCode,
      memberName: payment.member.fullName,
      houseNumber: payment.member.houseNumber,
      address: payment.member.address,
      contactNumber: payment.member.contactNumber,
      paymentDate: payment.paymentDate,
      paidAmount: payment.amount,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      referenceNumber: payment.referenceNumber,
      relevantMonth: payment.relevantMonth,
      collectedBy: payment.collectedByName,
      collectedByRole: payment.collectedByRole,
      notes: payment.notes,
      status: payment.isVoid ? 'Voided' : 'Valid',
      voidReason: payment.voidReason,
      voidedAt: payment.voidedAt,
      voidedBy: payment.voidedBy,
      allocations: payment.allocations.map((a) => ({
        id: a.id,
        challanId: a.challan.id,
        challanNumber: a.challan.challanNumber,
        month: a.challan.month,
        baseAmount: a.challan.baseAmount,
        allocatedAmount: a.allocatedAmount,
        remainingChallanBalance: a.challan.balance,
      })),
      receipt: payment.receipt,
    });
  } catch (error) {
    console.error('Fetch payment details error:', error);
    return res.status(500).json({ error: 'Failed to retrieve payment details' });
  }
});

// POST /api/payments (Admin & Collection Staff)
// Transactional "Oldest Due First" payment allocation
router.post('/', authenticateToken, requireRole(['ADMIN', 'COLLECTION_STAFF']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const {
      memberId,
      paidAmount,
      paymentDate,
      paymentMethod,
      paymentType,
      notes,
      referenceNumber,
      challanId,
    } = req.body;

    const amount = Number(paidAmount);
    if (!memberId || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid memberId and paidAmount (> 0) are required' });
    }

    const member = await prisma.member.findFirst({
      where: { OR: [{ id: memberId }, { memberCode: memberId }] },
    });

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const currentPaymentsCount = await prisma.payment.count();
    const currentYear = new Date().getFullYear();
    const receiptSerial = String(currentPaymentsCount + 1).padStart(3, '0');
    const receiptNumber = `REC-${currentYear}-${receiptSerial}`;
    const paymentNumber = `PAY-${currentYear}-${receiptSerial}`;

    // Execute transactional allocation
    const paymentResult = await prisma.$transaction(async (tx) => {
      // 1. Fetch all unpaid or partially paid challans for this member, ordered by oldest due first
      let pendingChallans = await tx.challan.findMany({
        where: {
          memberId: member.id,
          status: { in: ['Unpaid', 'Partial Paid'] },
        },
        orderBy: [{ year: 'asc' }, { monthKey: 'asc' }, { createdAt: 'asc' }],
      });

      // If a specific challan was paid from the UI, prioritize that challan
      if (challanId) {
        const priorityIndex = pendingChallans.findIndex(
          (c) => c.id === challanId || c.challanNumber === challanId
        );
        if (priorityIndex > -1) {
          const [targeted] = pendingChallans.splice(priorityIndex, 1);
          pendingChallans.unshift(targeted);
        }
      }

      // 2. Create the master Payment record
      const payment = await tx.payment.create({
        data: {
          paymentNumber,
          receiptNumber,
          memberId: member.id,
          amount,
          paymentDate: paymentDate || getLocalDateString(),
          paymentType: paymentType || 'Full Paid',
          paymentMethod: paymentMethod || 'Cash',
          referenceNumber: referenceNumber || null,
          relevantMonth: pendingChallans[0]?.month || 'Current Dues',
          collectedById: req.user?.userId || null,
          collectedByName: req.user?.fullName || 'Collection Staff',
          collectedByRole: req.user?.role === 'ADMIN' ? 'Admin' : 'Collection Staff',
          notes: notes || null,
          isVoid: false,
        },
      });

      // 3. Allocate sequentially to oldest due first
      let unallocated = amount;
      for (const challan of pendingChallans) {
        if (unallocated <= 0) break;

        const alloc = Math.min(unallocated, challan.balance);
        if (alloc > 0) {
          await tx.paymentAllocation.create({
            data: {
              paymentId: payment.id,
              challanId: challan.id,
              allocatedAmount: alloc,
            },
          });

          const newPaid = challan.paidAmount + alloc;
          const newBalance = Math.max(0, challan.totalAmount - newPaid);
          const newStatus = newBalance === 0 ? 'Paid' : newPaid > 0 ? 'Partial Paid' : 'Unpaid';

          await tx.challan.update({
            where: { id: challan.id },
            data: {
              paidAmount: newPaid,
              balance: newBalance,
              status: newStatus,
            },
          });

          unallocated -= alloc;
        }
      }

      // 4. Create Receipt
      await tx.receipt.create({
        data: {
          receiptNumber,
          paymentId: payment.id,
          issuedTo: member.fullName,
          issuedBy: req.user?.fullName || 'Authorized Cashier',
        },
      });

      return payment;
    });

    await logActivity({
      user: req.user?.fullName || 'Collector',
      role: req.user?.role || 'COLLECTION_STAFF',
      action: 'Payment Collected',
      module: 'Collections',
      description: `${paymentMethod || 'Cash'} payment of Rs. ${amount.toLocaleString()} received from ${member.fullName} (${receiptNumber})`,
      ipAddress: req.ip,
    });

    // ─── Automatic WhatsApp Paid PDF Dispatch (Baileys / Cloud API) ───
    let whatsappSent = false;
    try {
      const baileysState = getWhatsAppState();
      if (member.contactNumber) {
        const settings = (await prisma.associationSettings.findFirst({
          where: { id: 'default-settings' },
        })) || { organizationName: 'Resident Welfare Association', address: 'Block 12 FB Area', contactNumber: '', logoUrl: null };

        // Fetch the allocated challan to generate its branded Paid PDF
        let targetChallan: any = null;
        if (challanId) {
          const specificAlloc = await prisma.paymentAllocation.findFirst({
            where: {
              paymentId: paymentResult.id,
              OR: [{ challanId }, { challan: { challanNumber: challanId } }],
            },
            include: { challan: true },
          });
          if (specificAlloc?.challan) {
            targetChallan = specificAlloc.challan;
          }
        }

        if (!targetChallan) {
          const firstAllocation = await prisma.paymentAllocation.findFirst({
            where: { paymentId: paymentResult.id },
            include: { challan: true },
          });
          targetChallan = firstAllocation?.challan;
        }

        const caption =
          `🏘️ *${settings.organizationName || 'Resident Welfare Association'}*\n\n` +
          `Assalam o Alaikum, *${member.fullName}*!\n\n` +
          `🧾 *PAYMENT RECEIPT (PAID)*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📋 Receipt #: *${receiptNumber}*\n` +
          (targetChallan ? `📋 Challan #: *${targetChallan.challanNumber}*\n` : '') +
          `💰 Amount Paid: *Rs. ${amount.toLocaleString()}*\n` +
          `💳 Method: *${paymentMethod || 'Cash'}*\n` +
          `📅 Date: *${paymentDate || getLocalDateString()}*\n` +
          `👤 Cashier: *${req.user?.fullName || 'Administrator'}*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `✅ *Status: Paid & Verified ✓*\n\n` +
          `Aapka computer-generated Paid Challan PDF voucher sath attached hai.\n` +
          `_Resident Welfare Association Billing Portal_`;

        if (targetChallan) {
          try {
            // Generate Paid PDF Buffer Server-Side
            const pdfBuffer = await generateChallanPdfBuffer(
              {
                id: targetChallan.id,
                challanNumber: targetChallan.challanNumber,
                memberId: member.memberCode,
                memberName: member.fullName,
                houseNumber: member.houseNumber,
                address: member.address,
                month: targetChallan.month,
                dueDate: targetChallan.dueDate,
                totalAmount: targetChallan.totalAmount,
                paidAmount: targetChallan.paidAmount,
                balance: targetChallan.balance,
                status: targetChallan.status, // 'Paid' or 'Partial Paid'
                generatedDate: targetChallan.generatedDate,
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

            const safeFilename = `Paid_Challan_${targetChallan.challanNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

            if (baileysState.connected) {
              sendWhatsAppDocument(member.contactNumber, pdfBuffer, safeFilename, caption)
                .then((docRes) => {
                  if (docRes.success) {
                    console.log(`✅ [WhatsApp Baileys] Auto-sent Paid PDF to ${member.contactNumber} for ${receiptNumber}`);
                  } else {
                    console.warn(`[WhatsApp Baileys] PDF send failed, falling back to text:`, docRes.error);
                    sendWhatsAppText(member.contactNumber, caption).catch(console.error);
                  }
                })
                .catch((err) => {
                  console.warn(`[WhatsApp Baileys] Auto Paid PDF failed for ${receiptNumber}:`, err.message);
                  sendWhatsAppText(member.contactNumber, caption).catch(console.error);
                });
              whatsappSent = true;
            } else {
              // Baileys not connected: fallback to WhatsApp Cloud API / Sandbox provider
              const cloudRes = await sendChallanViaWhatsApp({
                recipientPhone: member.contactNumber,
                pdfBuffer,
                challanNumber: targetChallan.challanNumber,
                memberName: member.fullName,
                billingMonth: targetChallan.month,
                totalAmount: targetChallan.totalAmount,
                dueDate: targetChallan.dueDate,
              });
              if (cloudRes.success) {
                console.log(`✅ [WhatsApp Cloud API] Auto-dispatched Paid PDF for ${receiptNumber}`);
                whatsappSent = true;
              }
            }
          } catch (pdfErr: any) {
            console.warn('[PDF] Error generating paid PDF buffer:', pdfErr.message);
            if (baileysState.connected) {
              sendWhatsAppText(member.contactNumber, caption).catch(console.error);
            }
            whatsappSent = true;
          }
        } else {
          // No linked challan, send text receipt confirmation
          if (baileysState.connected) {
            sendWhatsAppText(member.contactNumber, caption).catch(console.error);
            whatsappSent = true;
          }
        }
      }
    } catch (waErr: any) {
      console.warn('[WhatsApp] Auto receipt error:', waErr.message);
    }

    return res.status(201).json({
      id: paymentResult.id,
      receiptNumber: paymentResult.receiptNumber,
      memberId: member.memberCode,
      memberName: member.fullName,
      houseNumber: member.houseNumber,
      paymentDate: paymentResult.paymentDate,
      paidAmount: paymentResult.amount,
      paymentType: paymentResult.paymentType,
      paymentMethod: paymentResult.paymentMethod,
      relevantMonth: paymentResult.relevantMonth,
      collectedBy: paymentResult.collectedByName,
      collectedByRole: paymentResult.collectedByRole,
      notes: paymentResult.notes,
      status: 'Valid',
      whatsappSent,
    });
  } catch (error: any) {
    console.error('Payment collection error:', error);
    return res.status(500).json({ error: error.message || 'Failed to record payment' });
  }
});

// POST /api/payments/:id/void (Admin only)
// Transactional payment voiding and allocation reversal
router.post('/:id/void', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A justification reason is required to void a payment' });
    }

    const payment = await prisma.payment.findFirst({
      where: { OR: [{ id }, { receiptNumber: id }] },
      include: {
        allocations: {
          include: {
            challan: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.isVoid) {
      return res.status(400).json({ error: 'Payment has already been voided' });
    }

    // Revert allocations transactionally
    await prisma.$transaction(async (tx) => {
      // 1. Mark payment void
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          isVoid: true,
          voidReason: reason.trim(),
          voidedAt: new Date(),
          voidedBy: req.user?.fullName || 'Admin Supervisor',
        },
      });

      // 2. Revert allocations on each affected challan
      for (const alloc of payment.allocations) {
        const challan = alloc.challan;
        const revertedPaid = Math.max(0, challan.paidAmount - alloc.allocatedAmount);
        const revertedBalance = challan.totalAmount - revertedPaid;
        const revertedStatus = revertedPaid === 0 ? 'Unpaid' : 'Partial Paid';

        await tx.challan.update({
          where: { id: challan.id },
          data: {
            paidAmount: revertedPaid,
            balance: revertedBalance,
            status: revertedStatus,
          },
        });
      }
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: 'ADMIN',
      action: 'Payment Voided',
      module: 'Collections',
      description: `Receipt ${payment.receiptNumber} voided. Reason: ${reason.trim()}`,
      ipAddress: req.ip,
    });

    return res.json({
      message: `Payment ${payment.receiptNumber} voided successfully`,
      receiptNumber: payment.receiptNumber,
      status: 'Voided',
    });
  } catch (error: any) {
    console.error('Payment void error:', error);
    return res.status(500).json({ error: error.message || 'Failed to void payment' });
  }
});

export default router;
