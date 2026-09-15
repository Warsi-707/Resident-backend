import { Router, Response } from 'express';
import { prisma } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/reports/monthly
router.get('/monthly', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { year = '2024' } = req.query;

    const challans = await prisma.challan.findMany({
      where: { year: Number(year) },
      include: {
        member: true,
      },
    });

    const payments = await prisma.payment.findMany({
      where: {
        isVoid: false,
        paymentDate: { startsWith: String(year) },
      },
    });

    // Aggregate by monthKey
    const monthMap: Record<string, {
      month: string;
      billed: number;
      collected: number;
      pending: number;
      challansCount: number;
      paidChallansCount: number;
    }> = {};

    challans.forEach((c) => {
      if (!monthMap[c.month]) {
        monthMap[c.month] = {
          month: c.month,
          billed: 0,
          collected: 0,
          pending: 0,
          challansCount: 0,
          paidChallansCount: 0,
        };
      }
      monthMap[c.month].billed += c.baseAmount;
      monthMap[c.month].collected += c.paidAmount;
      monthMap[c.month].pending += c.balance;
      monthMap[c.month].challansCount += 1;
      if (c.status === 'Paid') monthMap[c.month].paidChallansCount += 1;
    });

    const summary = Object.values(monthMap);

    return res.json({
      year: Number(year),
      summary,
      totalBilled: summary.reduce((s, m) => s + m.billed, 0),
      totalCollected: summary.reduce((s, m) => s + m.collected, 0),
      totalPending: summary.reduce((s, m) => s + m.pending, 0),
    });
  } catch (error) {
    console.error('Monthly report error:', error);
    return res.status(500).json({ error: 'Failed to generate monthly report' });
  }
});

// GET /api/reports/status
router.get('/status', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const members = await prisma.member.findMany({
      include: {
        challans: {
          orderBy: { generatedDate: 'desc' },
        },
      },
      orderBy: { memberCode: 'asc' },
    });

    const records = members.map((m) => {
      const unpaidCount = m.challans.filter((c) => c.status === 'Unpaid').length;
      const partialCount = m.challans.filter((c) => c.status === 'Partial Paid').length;
      const paidCount = m.challans.filter((c) => c.status === 'Paid').length;
      const totalBalance = m.challans.reduce((s, c) => s + c.balance, 0);

      let overallStatus = 'Up to Date';
      if (totalBalance > 0 && unpaidCount > 1) overallStatus = 'Defaulter (2+ Months)';
      else if (totalBalance > 0) overallStatus = 'Pending Current Month';

      return {
        memberId: m.memberCode,
        memberName: m.fullName,
        houseNumber: m.houseNumber,
        block: m.block || 'Block A',
        contactNumber: m.contactNumber,
        totalBalance,
        unpaidChallans: unpaidCount,
        partialChallans: partialCount,
        paidChallans: paidCount,
        status: overallStatus,
      };
    });

    return res.json({
      totalMembers: members.length,
      records,
    });
  } catch (error) {
    console.error('Status report error:', error);
    return res.status(500).json({ error: 'Failed to generate status report' });
  }
});

// GET /api/reports/staff
router.get('/staff', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const staffList = await prisma.staff.findMany({
      where: { status: 'Active' },
    });

    const staffReports = await Promise.all(
      staffList.map(async (staff) => {
        const payments = await prisma.payment.findMany({
          where: {
            OR: [
              { collectedById: staff.id },
              { collectedByName: staff.fullName },
            ],
            isVoid: false,
          },
          orderBy: { paymentDate: 'desc' },
        });

        const totalCash = payments.filter((p) => p.paymentMethod === 'Cash').reduce((s, p) => s + p.amount, 0);
        const totalOnline = payments.filter((p) => p.paymentMethod === 'Online').reduce((s, p) => s + p.amount, 0);
        const totalAmount = payments.reduce((s, p) => s + p.amount, 0);

        return {
          staffId: staff.id,
          staffCode: staff.staffCode,
          name: staff.fullName,
          phone: staff.contactNumber,
          totalReceiptsIssued: payments.length,
          totalCashCollected: totalCash,
          totalOnlineCollected: totalOnline,
          totalCollected: totalAmount,
          recentCollections: payments.slice(0, 3).map((p) => ({
            receiptNumber: p.receiptNumber,
            amount: p.amount,
            date: p.paymentDate,
            method: p.paymentMethod,
          })),
        };
      })
    );

    return res.json({ staffReports });
  } catch (error) {
    console.error('Staff report error:', error);
    return res.status(500).json({ error: 'Failed to generate staff report' });
  }
});

export default router;
