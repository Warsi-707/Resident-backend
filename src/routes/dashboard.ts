import { Router, Response } from 'express';
import { prisma } from '../db';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/dashboard/summary
router.get('/summary', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    // Execute all Prisma DB calls in Promise.all concurrently for maximum speed
    const [totalMembers, activeMembers, challans, validPayments, recentLogs] = await Promise.all([
      prisma.member.count(),
      prisma.member.count({ where: { status: 'Active' } }),
      prisma.challan.findMany(),
      prisma.payment.findMany({
        where: { isVoid: false },
        include: {
          member: {
            select: {
              memberCode: true,
              fullName: true,
              houseNumber: true,
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
      }),
      prisma.activityLog.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalBilled = challans.reduce((sum, c) => sum + c.baseAmount, 0);
    const totalOutstanding = challans.reduce((sum, c) => sum + c.balance, 0);

    const unpaidCount = challans.filter((c) => c.status === 'Unpaid').length;
    const partialCount = challans.filter((c) => c.status === 'Partial Paid').length;
    const paidCount = challans.filter((c) => c.status === 'Paid').length;

    const totalCollected = validPayments.reduce((sum, p) => sum + p.amount, 0);
    const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

    const recentPayments = validPayments.slice(0, 5).map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      memberId: p.member.memberCode,
      memberName: p.member.fullName,
      houseNumber: p.member.houseNumber,
      amount: p.amount,
      date: p.paymentDate,
      paymentMethod: p.paymentMethod,
    }));

    // Dynamically calculate monthly trends from PostgreSQL records
    const trendsMap: Record<string, { month: string; billed: number; collected: number }> = {};

    // Group challans by month
    challans.forEach((c) => {
      const monthLabel = c.month;
      if (!trendsMap[monthLabel]) {
        trendsMap[monthLabel] = { month: monthLabel, billed: 0, collected: 0 };
      }
      trendsMap[monthLabel].billed += c.baseAmount;
      trendsMap[monthLabel].collected += c.paidAmount;
    });

    // If no database challans yet, provide clean empty / current month entry
    let monthlyData = Object.values(trendsMap);
    if (monthlyData.length === 0) {
      const currentMonthName = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
      monthlyData = [{ month: currentMonthName, billed: totalBilled, collected: totalCollected }];
    }

    return res.json({
      kpis: {
        totalMembers,
        activeMembers,
        totalBilled,
        totalOutstanding,
        totalCollected,
        collectionRate,
        challanCounts: {
          total: challans.length,
          unpaid: unpaidCount,
          partial: partialCount,
          paid: paidCount,
        },
      },
      recentPayments,
      recentLogs: recentLogs.map((l) => ({
        id: l.id,
        user: l.user,
        role: l.role,
        action: l.action,
        module: l.module,
        description: l.description,
        date: l.date,
        time: l.time,
        timestamp: l.timestamp,
      })),
      monthlyTrends: monthlyData,
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return res.status(500).json({ error: 'Failed to retrieve dashboard summary' });
  }
});

export default router;
