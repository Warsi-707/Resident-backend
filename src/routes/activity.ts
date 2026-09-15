import { Router, Response } from 'express';
import { prisma } from '../db';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/activity
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  try {
    const logs = await prisma.activityLog.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    return res.json(
      logs.map((l) => ({
        id: l.id,
        user: l.user,
        role: l.role,
        action: l.action,
        module: l.module,
        description: l.description,
        date: l.date,
        time: l.time,
        timestamp: l.timestamp || l.createdAt.getTime(),
      }))
    );
  } catch (error) {
    console.error('Fetch activity logs error:', error);
    return res.status(500).json({ error: 'Failed to retrieve activity logs' });
  }
});

export default router;
