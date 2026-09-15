import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../utils/logger';

const router = Router();

// GET /api/staff
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const staffMembers = await prisma.staff.findMany({
      orderBy: { staffCode: 'asc' },
    });

    const staffWithMetrics = await Promise.all(
      staffMembers.map(async (s) => {
        // Compute collection counts and total amount collected from valid payments
        const payments = await prisma.payment.findMany({
          where: {
            OR: [
              { collectedById: s.id },
              { collectedByName: s.fullName },
            ],
            isVoid: false,
          },
          select: { amount: true },
        });

        const totalAmountCollected = payments.reduce((sum, p) => sum + p.amount, 0);
        const totalCollectionsCount = payments.length;

        return {
          id: s.id,
          staffCode: s.staffCode,
          fullName: s.fullName,
          contactNumber: s.contactNumber,
          email: s.email || '',
          username: s.username,
          role: 'Collection Staff',
          roleTitle: s.roleTitle,
          status: s.status,
          joiningDate: s.joiningDate,
          totalCollectionsCount,
          totalAmountCollected,
        };
      })
    );

    return res.json(staffWithMetrics);
  } catch (error) {
    console.error('Fetch staff error:', error);
    return res.status(500).json({ error: 'Failed to retrieve staff' });
  }
});

// POST /api/staff (Admin only)
router.post('/', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { fullName, contactNumber, username, password, email, roleTitle } = req.body;

    if (!fullName || !contactNumber || !username) {
      return res.status(400).json({ error: 'Full name, contact number, and username are required' });
    }

    const count = await prisma.staff.count();
    const staffCode = `STF-${String(count + 1).padStart(3, '0')}`;
    const cleanUsername = username.trim().toLowerCase();
    const [existingMember, existingUser] = await Promise.all([
      prisma.member.findFirst({
        where: { username: { equals: cleanUsername, mode: 'insensitive' } },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { username: { equals: cleanUsername, mode: 'insensitive' } },
        select: { id: true },
      }),
    ]);

    if (existingMember || existingUser) {
      return res.status(409).json({
        success: false,
        message: 'This username is already in use. Please choose another username.',
      });
    }

    const passwordHash = await bcrypt.hash(password || 'staff123', 10);

    const newStaff = await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          staffCode,
          fullName,
          contactNumber,
          email: email || null,
          username: cleanUsername,
          roleTitle: roleTitle || 'Collection Staff',
          status: 'Active',
          joiningDate: new Date().toISOString().split('T')[0],
        },
      });

      await tx.user.create({
        data: {
          username: cleanUsername,
          passwordHash,
          fullName,
          role: 'COLLECTION_STAFF',
          status: 'ACTIVE',
          staffId: staff.id,
          email: email || null,
          contactNumber,
        },
      });

      return staff;
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: req.user?.role || 'ADMIN',
      action: 'Staff Added',
      module: 'Staff Management',
      description: `Created staff account for ${newStaff.fullName} (${newStaff.username})`,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      id: newStaff.id,
      staffCode: newStaff.staffCode,
      fullName: newStaff.fullName,
      contactNumber: newStaff.contactNumber,
      email: newStaff.email || '',
      username: newStaff.username,
      role: 'Collection Staff',
      roleTitle: newStaff.roleTitle,
      status: newStaff.status,
      joiningDate: newStaff.joiningDate,
      totalCollectionsCount: 0,
      totalAmountCollected: 0,
    });
  } catch (error: any) {
    console.error('Create staff error:', error);
    if (
      error.code === 'P2002' ||
      (typeof error.message === 'string' && error.message.includes('Unique constraint failed'))
    ) {
      return res.status(409).json({
        success: false,
        message: 'This username is already in use. Please choose another username.',
      });
    }
    return res.status(500).json({ error: error.message || 'Failed to create staff' });
  }
});

// PUT /api/staff/:id (Admin only)
router.put('/:id', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { fullName, contactNumber, email, roleTitle, status } = req.body;

    const existing = await prisma.staff.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const updated = await prisma.staff.update({
      where: { id },
      data: {
        fullName: fullName ?? existing.fullName,
        contactNumber: contactNumber ?? existing.contactNumber,
        email: email !== undefined ? email : existing.email,
        roleTitle: roleTitle ?? existing.roleTitle,
        status: status ?? existing.status,
      },
    });

    // Also update User profile if exists
    await prisma.user.updateMany({
      where: { staffId: id },
      data: {
        fullName: updated.fullName,
        contactNumber: updated.contactNumber,
        email: updated.email,
        status: updated.status === 'Active' ? 'ACTIVE' : 'INACTIVE',
      },
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: req.user?.role || 'ADMIN',
      action: 'Staff Updated',
      module: 'Staff Management',
      description: `Updated profile details for staff member ${updated.fullName}`,
      ipAddress: req.ip,
    });

    return res.json(updated);
  } catch (error) {
    console.error('Update staff error:', error);
    return res.status(500).json({ error: 'Failed to update staff' });
  }
});

// PATCH /api/staff/:id/toggle-status (Admin only)
router.patch('/:id/toggle-status', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const existing = await prisma.staff.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const newStatus = existing.status === 'Active' ? 'Inactive' : 'Active';

    const updated = await prisma.staff.update({
      where: { id },
      data: { status: newStatus },
    });

    await prisma.user.updateMany({
      where: { staffId: id },
      data: { status: newStatus === 'Active' ? 'ACTIVE' : 'INACTIVE' },
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: req.user?.role || 'ADMIN',
      action: newStatus === 'Active' ? 'Staff Activated' : 'Staff Deactivated',
      module: 'Staff Management',
      description: `Changed status of ${updated.fullName} to ${newStatus}`,
      ipAddress: req.ip,
    });

    return res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    console.error('Toggle staff status error:', error);
    return res.status(500).json({ error: 'Failed to toggle staff status' });
  }
});

export default router;
