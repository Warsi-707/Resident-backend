import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../utils/logger';

const router = Router();

// Helper to compute member financial metrics dynamically from challans and payments
async function calculateMemberFinancials(memberId: string) {
  const challans = await prisma.challan.findMany({
    where: { memberId },
    orderBy: [{ year: 'asc' }, { monthKey: 'asc' }],
  });

  const payments = await prisma.payment.findMany({
    where: { memberId, isVoid: false },
  });

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  // Latest challan is current month, earlier ones are previous dues
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let currentMonthDue = 0;
  let previousDues = 0;
  let totalOutstanding = 0;

  for (const c of challans) {
    if (c.balance > 0) {
      totalOutstanding += c.balance;
      if (c.monthKey === currentMonthKey || c.monthKey === '2024-09') {
        currentMonthDue += c.balance;
      } else {
        previousDues += c.balance;
      }
    }
  }

  return {
    previousDues,
    currentMonthDue,
    totalOutstanding,
    totalPaid,
  };
}

// GET /api/members
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const members = await prisma.member.findMany({
      orderBy: { memberCode: 'asc' },
      include: {
        challans: {
          select: {
            id: true,
            monthKey: true,
            balance: true,
            status: true,
          },
        },
        payments: {
          where: { isVoid: false },
          select: { amount: true },
        },
      },
    });

    const formatted = members.map((m) => {
      const totalPaid = m.payments.reduce((sum, p) => sum + p.amount, 0);
      let totalOutstanding = 0;
      let currentMonthDue = 0;
      let previousDues = 0;

      for (const c of m.challans) {
        if (c.balance > 0) {
          totalOutstanding += c.balance;
          if (c.monthKey === '2024-09') {
            currentMonthDue += c.balance;
          } else {
            previousDues += c.balance;
          }
        }
      }

      return {
        id: m.id,
        memberId: m.memberCode,
        memberCode: m.memberCode,
        fullName: m.fullName,
        name: m.fullName,
        houseNumber: m.houseNumber,
        address: m.address,
        contactNumber: m.contactNumber,
        phone: m.contactNumber,
        email: m.email || '',
        plotNumber: m.plotNumber || '',
        block: m.block || '',
        monthlyDueAmount: m.monthlyDueAmount,
        monthlyAmount: m.monthlyDueAmount,
        joiningDate: m.joiningDate,
        status: m.status,
        username: m.username,
        previousDues,
        currentMonthDue,
        totalOutstanding,
        totalPaid,
        memberType: m.block ? m.block.toUpperCase() : 'RESIDENTIAL',
        floors: m.plotNumber ? m.plotNumber.split(',').map((s) => s.trim()).filter(Boolean) : ['Ground'],
      };
    });

    return res.json(formatted);
  } catch (error) {
    console.error('Fetch members error:', error);
    return res.status(500).json({ error: 'Failed to retrieve members' });
  }
});

// GET /api/members/:id
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const member = await prisma.member.findFirst({
      where: {
        OR: [{ id }, { memberCode: id }],
      },
    });

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const financials = await calculateMemberFinancials(member.id);

    return res.json({
      id: member.id,
      memberId: member.memberCode,
      memberCode: member.memberCode,
      fullName: member.fullName,
      name: member.fullName,
      houseNumber: member.houseNumber,
      address: member.address,
      contactNumber: member.contactNumber,
      phone: member.contactNumber,
      email: member.email || '',
      plotNumber: member.plotNumber || '',
      block: member.block || '',
      monthlyDueAmount: member.monthlyDueAmount,
      monthlyAmount: member.monthlyDueAmount,
      joiningDate: member.joiningDate,
      status: member.status,
      username: member.username,
      memberType: member.block ? member.block.toUpperCase() : 'RESIDENTIAL',
      floors: member.plotNumber ? member.plotNumber.split(',').map((s) => s.trim()).filter(Boolean) : ['Ground'],
      ...financials,
    });
  } catch (error) {
    console.error('Fetch member error:', error);
    return res.status(500).json({ error: 'Failed to retrieve member details' });
  }
});

// GET /api/members/:id/ledger
router.get('/:id/ledger', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const member = await prisma.member.findFirst({
      where: {
        OR: [{ id }, { memberCode: id }],
      },
    });

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const challans = await prisma.challan.findMany({
      where: { memberId: member.id },
      orderBy: { generatedDate: 'asc' },
    });

    const payments = await prisma.payment.findMany({
      where: { memberId: member.id, isVoid: false },
      orderBy: { paymentDate: 'asc' },
    });

    interface RawLedger {
      date: string;
      month: string;
      reference: string;
      description: string;
      debit: number;
      credit: number;
    }

    const raw: RawLedger[] = [];

    challans.forEach((c) => {
      raw.push({
        date: c.generatedDate,
        month: c.month,
        reference: c.challanNumber,
        description: `Monthly Maintenance Bill (${c.month})`,
        debit: c.baseAmount,
        credit: 0,
      });
    });

    payments.forEach((p) => {
      raw.push({
        date: p.paymentDate,
        month: p.relevantMonth,
        reference: p.receiptNumber,
        description: `Payment received (${p.paymentMethod} - ${p.paymentType})`,
        debit: 0,
        credit: p.amount,
      });
    });

    // Sort chronologically
    raw.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    const ledger = raw.map((entry, idx) => {
      running += entry.debit - entry.credit;
      return {
        id: `led-${idx + 1}`,
        memberId: member.memberCode,
        date: entry.date,
        month: entry.month,
        reference: entry.reference,
        description: entry.description,
        debit: entry.debit,
        credit: entry.credit,
        runningBalance: running,
      };
    });

    return res.json(ledger);
  } catch (error) {
    console.error('Fetch member ledger error:', error);
    return res.status(500).json({ error: 'Failed to retrieve member ledger' });
  }
});

// Helper to normalize username
function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

// Helper to check if a username exists in Member or User table (case-insensitive)
async function isUsernameTaken(username: string, excludeMemberId?: string, excludeUserId?: string): Promise<boolean> {
  const clean = normalizeUsername(username);
  if (!clean) return false;

  const [existingMember, existingUser] = await Promise.all([
    prisma.member.findFirst({
      where: {
        username: { equals: clean, mode: 'insensitive' },
        ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
      },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: {
        username: { equals: clean, mode: 'insensitive' },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
    }),
  ]);

  return !!(existingMember || existingUser);
}

// Helper to auto-generate a unique username based on memberCode / house number
async function generateUniqueUsername(memberCode: string, houseNumber?: string): Promise<string> {
  // Base candidate from memberCode e.g. "RWA-2026-001" -> "rwa2026001"
  let base = memberCode.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (!base) {
    base = (houseNumber || 'member').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'member';
  }

  let candidate = base;
  let counter = 1;

  while (await isUsernameTaken(candidate)) {
    counter++;
    candidate = `${base}-${counter}`;
  }

  return candidate;
}

// POST /api/members (Admin only)
router.post('/', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const {
      fullName,
      houseNumber,
      address,
      contactNumber,
      monthlyAmount,
      joiningDate,
      email,
      plotNumber,
      block,
      propertyType,
      floor,
      floors,
      memberType,
      username,
      password,
    } = req.body;

    const finalAddress = (address || houseNumber || '').trim();
    const finalHouseNumber = (houseNumber || address || '').trim();

    if (!fullName || !finalAddress || !contactNumber) {
      return res.status(400).json({ error: 'Full name, address, and contact number are required' });
    }

    let parsedFloors: string[] = [];
    if (Array.isArray(floors) && floors.length > 0) {
      parsedFloors = floors.map((f: any) => String(f).trim()).filter(Boolean);
    } else if (floor) {
      parsedFloors = [String(floor).trim()];
    } else if (plotNumber) {
      parsedFloors = String(plotNumber).split(',').map((f) => f.trim()).filter(Boolean);
    }
    const finalPlotNumber = parsedFloors.length > 0 ? parsedFloors.join(', ') : 'Ground';
    const finalBlock = (propertyType || memberType || block || 'RESIDENTIAL').toUpperCase().trim();

    const currentYear = new Date().getFullYear();
    const count = await prisma.member.count();
    let nextNum = count + 1;
    let nextCode = `RWA-${currentYear}-${String(nextNum).padStart(3, '0')}`;
    while (await prisma.member.findUnique({ where: { memberCode: nextCode } })) {
      nextNum++;
      nextCode = `RWA-${currentYear}-${String(nextNum).padStart(3, '0')}`;
    }

    // Determine clean normalized username
    let cleanUsername = '';
    if (username && typeof username === 'string' && username.trim().length > 0) {
      cleanUsername = normalizeUsername(username);
      // Check if username already exists in Member or User table
      if (await isUsernameTaken(cleanUsername)) {
        return res.status(409).json({
          success: false,
          message: 'This username is already in use. Please choose another username.',
        });
      }
    } else {
      cleanUsername = await generateUniqueUsername(nextCode, finalHouseNumber);
    }

    // Default password if not provided
    const passwordHash = await bcrypt.hash(password || 'member123', 10);

    const newMember = await prisma.$transaction(async (tx) => {
      const member = await tx.member.create({
        data: {
          memberCode: nextCode,
          fullName: fullName.trim(),
          houseNumber: finalHouseNumber,
          address: finalAddress,
          contactNumber: contactNumber.trim(),
          email: email ? email.trim().toLowerCase() : null,
          plotNumber: finalPlotNumber,
          block: finalBlock,
          monthlyDueAmount: monthlyAmount !== undefined && !isNaN(Number(monthlyAmount)) ? Number(monthlyAmount) : 0,
          status: 'Active',
          joiningDate: joiningDate || new Date().toISOString().split('T')[0],
          username: cleanUsername,
        },
      });

      // Create matching User account for login
      await tx.user.create({
        data: {
          username: cleanUsername,
          passwordHash,
          fullName: fullName.trim(),
          role: 'MEMBER',
          status: 'ACTIVE',
          memberId: member.id,
          email: email ? email.trim().toLowerCase() : null,
          contactNumber: contactNumber.trim(),
        },
      });

      return member;
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: req.user?.role || 'ADMIN',
      action: 'Member Created',
      module: 'Member Management',
      description: `Registered new resident ${newMember.fullName} (${newMember.memberCode}) for ${newMember.houseNumber}`,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      id: newMember.id,
      memberId: newMember.memberCode,
      fullName: newMember.fullName,
      houseNumber: newMember.houseNumber,
      address: newMember.address,
      contactNumber: newMember.contactNumber,
      email: newMember.email || '',
      plotNumber: newMember.plotNumber || '',
      block: newMember.block || '',
      monthlyAmount: newMember.monthlyDueAmount,
      joiningDate: newMember.joiningDate,
      status: newMember.status,
      username: newMember.username,
      memberType: newMember.block ? newMember.block.toUpperCase() : 'RESIDENTIAL',
      floors: newMember.plotNumber ? newMember.plotNumber.split(',').map((s) => s.trim()).filter(Boolean) : ['Ground'],
      previousDues: 0,
      currentMonthDue: newMember.monthlyDueAmount,
      totalOutstanding: newMember.monthlyDueAmount,
      totalPaid: 0,
    });
  } catch (error: any) {
    console.error('Create member error:', error);
    if (
      error.code === 'P2002' ||
      (typeof error.message === 'string' && error.message.includes('Unique constraint failed'))
    ) {
      return res.status(409).json({
        success: false,
        message: 'This username is already in use. Please choose another username.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to create member. Please check details and try again.',
      error: error.message || 'Failed to create member',
    });
  }
});

// PUT /api/members/:id (Admin only)
router.put('/:id', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const {
      fullName,
      houseNumber,
      address,
      contactNumber,
      monthlyAmount,
      status,
      email,
      plotNumber,
      block,
      propertyType,
      floor,
      floors,
      memberType,
      username,
    } = req.body;

    const existing = await prisma.member.findFirst({
      where: { OR: [{ id }, { memberCode: id }] },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Member not found' });
    }

    let finalPlotNumber = plotNumber;
    if (floors !== undefined && Array.isArray(floors)) {
      finalPlotNumber = floors.join(', ');
    } else if (floor !== undefined) {
      finalPlotNumber = floor;
    }

    let finalBlock = block;
    if (propertyType !== undefined) {
      finalBlock = propertyType.toUpperCase().trim();
    } else if (memberType !== undefined) {
      finalBlock = memberType.toUpperCase().trim();
    }

    let cleanUsername: string | undefined = undefined;
    if (username !== undefined && typeof username === 'string' && username.trim().length > 0) {
      cleanUsername = normalizeUsername(username);
      if (cleanUsername !== normalizeUsername(existing.username)) {
        const linkedUser = await prisma.user.findFirst({
          where: { memberId: existing.id },
          select: { id: true },
        });

        if (await isUsernameTaken(cleanUsername, existing.id, linkedUser?.id)) {
          return res.status(409).json({
            success: false,
            message: 'This username is already in use. Please choose another username.',
          });
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const member = await tx.member.update({
        where: { id: existing.id },
        data: {
          fullName: fullName !== undefined ? fullName.trim() : existing.fullName,
          houseNumber: houseNumber !== undefined ? houseNumber.trim() : existing.houseNumber,
          address: address !== undefined ? address.trim() : existing.address,
          contactNumber: contactNumber !== undefined ? contactNumber.trim() : existing.contactNumber,
          monthlyDueAmount: monthlyAmount !== undefined ? Number(monthlyAmount) : existing.monthlyDueAmount,
          status: status ?? existing.status,
          email: email !== undefined ? (email ? email.trim().toLowerCase() : null) : existing.email,
          plotNumber: finalPlotNumber !== undefined ? finalPlotNumber : existing.plotNumber,
          block: finalBlock !== undefined ? finalBlock : existing.block,
          username: cleanUsername ?? existing.username,
        },
      });

      if (cleanUsername && cleanUsername !== existing.username) {
        await tx.user.updateMany({
          where: { memberId: existing.id },
          data: { username: cleanUsername },
        });
      }

      return member;
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: req.user?.role || 'ADMIN',
      action: 'Member Updated',
      module: 'Member Management',
      description: `Updated profile details for ${updated.memberCode} (${updated.fullName})`,
      ipAddress: req.ip,
    });

    const financials = await calculateMemberFinancials(updated.id);

    return res.json({
      id: updated.id,
      memberId: updated.memberCode,
      fullName: updated.fullName,
      houseNumber: updated.houseNumber,
      address: updated.address,
      contactNumber: updated.contactNumber,
      email: updated.email || '',
      plotNumber: updated.plotNumber || '',
      block: updated.block || '',
      monthlyAmount: updated.monthlyDueAmount,
      joiningDate: updated.joiningDate,
      status: updated.status,
      username: updated.username,
      memberType: updated.block ? updated.block.toUpperCase() : 'RESIDENTIAL',
      floors: updated.plotNumber ? updated.plotNumber.split(',').map((s) => s.trim()).filter(Boolean) : ['Ground'],
      ...financials,
    });
  } catch (error: any) {
    console.error('Update member error:', error);
    if (
      error.code === 'P2002' ||
      (typeof error.message === 'string' && error.message.includes('Unique constraint failed'))
    ) {
      return res.status(409).json({
        success: false,
        message: 'This username is already in use. Please choose another username.',
      });
    }
    return res.status(500).json({ error: 'Failed to update member' });
  }
});

// PATCH /api/members/:id/toggle-status (Admin only)
router.patch('/:id/toggle-status', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const existing = await prisma.member.findFirst({
      where: { OR: [{ id }, { memberCode: id }] },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const newStatus = existing.status === 'Active' ? 'Inactive' : 'Active';

    const updated = await prisma.member.update({
      where: { id: existing.id },
      data: { status: newStatus },
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: req.user?.role || 'ADMIN',
      action: newStatus === 'Active' ? 'Member Activated' : 'Member Deactivated',
      module: 'Member Management',
      description: `Changed status of ${updated.fullName} (${updated.memberCode}) to ${newStatus}`,
      ipAddress: req.ip,
    });

    return res.json({
      id: updated.id,
      memberId: updated.memberCode,
      status: updated.status,
    });
  } catch (error) {
    console.error('Toggle member status error:', error);
    return res.status(500).json({ error: 'Failed to toggle member status' });
  }
});

// DELETE /api/members/:id (Admin only)
router.delete('/:id', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const existing = await prisma.member.findFirst({
      where: { OR: [{ id }, { memberCode: id }] },
      include: {
        _count: {
          select: {
            challans: true,
            payments: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Protect financial integrity: if member has challans or payments, disallow deletion
    if (existing._count.challans > 0 || existing._count.payments > 0) {
      return res.status(400).json({
        error: `Cannot permanently delete member ${existing.memberCode} because they have ${existing._count.challans} challan(s) and ${existing._count.payments} payment record(s). Please set their status to 'Inactive' instead to preserve financial audit history.`,
      });
    }

    // Safe deletion for member with no financial history
    await prisma.user.deleteMany({
      where: { memberId: existing.id },
    });
    await prisma.member.delete({
      where: { id: existing.id },
    });

    await logActivity({
      user: req.user?.fullName || 'Admin',
      role: 'ADMIN',
      action: 'Member Deleted',
      module: 'Member Management',
      description: `Permanently deleted member ${existing.memberCode} (${existing.fullName}) with zero financial history`,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: `Member ${existing.fullName} deleted successfully` });
  } catch (error: any) {
    console.error('Delete member error:', error);
    return res.status(500).json({ error: error.message || 'Failed to delete member' });
  }
});

export default router;
