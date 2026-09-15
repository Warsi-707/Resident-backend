import { prisma } from '../db';

export async function logActivity(options: {
  user: string;
  role: string;
  action: string;
  module: string;
  description: string;
  ipAddress?: string;
}) {
  try {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await prisma.activityLog.create({
      data: {
        user: options.user,
        role: options.role,
        action: options.action,
        module: options.module,
        description: options.description,
        ipAddress: options.ipAddress || null,
        timestamp: Date.now(),
        date,
        time,
      },
    });
  } catch (err) {
    console.error('Failed to write activity log:', err);
  }
}
