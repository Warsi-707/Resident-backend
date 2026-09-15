import { Router, Response } from 'express';
import { prisma } from '../db';
import { seedDatabase } from '../../prisma/seed';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../utils/logger';

const router = Router();

// POST /api/reset-sample-data (Admin only)
// Completely resets the PostgreSQL backend database:
// Clears all challans, payments, allocations, receipts, and audit logs.
router.post('/', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { wipeMembers = true } = req.body || {};

    // 1. Delete all transactional records in safe relational order
    await prisma.paymentAllocation.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.challan.deleteMany({});

    // 2. Wipe all members and their portal accounts
    if (wipeMembers !== false) {
      await prisma.user.deleteMany({ where: { role: 'MEMBER' } });
      await prisma.member.deleteMany({});
    }

    await prisma.activityLog.deleteMany({});

    // 3. Re-seed default admin, staff and settings
    await seedDatabase();

    await logActivity({
      user: req.user?.fullName || 'Administrator',
      role: 'ADMIN',
      action: 'Database Reset',
      module: 'Settings',
      description: `Backend database reset successfully. All members, challans, and transaction records cleared from PostgreSQL.`,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: 'Backend database has been reset successfully. All members, challans, and payments cleared.',
    });
  } catch (error: any) {
    console.error('Reset database error:', error);
    return res.status(500).json({ error: error.message || 'Failed to reset database' });
  }
});

export default router;
