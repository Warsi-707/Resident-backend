import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function resetDemoDatabase() {
  console.log('WARNING: Performing explicit demo database reset...');

  // 1. Clear operational records in reverse foreign-key relation order
  await prisma.activityLog.deleteMany({});
  await prisma.paymentAllocation.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.challan.deleteMany({});
  await prisma.staff.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.associationSettings.deleteMany({});

  // 2. Encrypt default credentials
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const staffPasswordHash = await bcrypt.hash('staff123', 10);

  // 3. Settings for RWA
  await prisma.associationSettings.create({
    data: {
      id: 'default-settings',
      organizationName: 'Resident Welfare Association',
      address: 'Block 12 · FB Area, Karachi',
      contactNumber: '+92 (21) 3634-8920 / +92 (300) 821-9401',
      currency: 'Rs',
      defaultDueDay: 10,
      challanFooter: 'Please deposit the fee by the due date at the RWA Accounts Office or via Online Bank Transfer.',
      receiptFooter: 'Official computer-generated receipt issued by Resident Welfare Association.',
    },
  });

  // 4. Staff Profile
  const staff1 = await prisma.staff.create({
    data: {
      staffCode: 'STF-001',
      fullName: 'Nasir Mahmood',
      contactNumber: '+92 321 5123456',
      email: 'nasir@rwa-block12.org',
      username: 'staff',
      roleTitle: 'Collection Staff',
      status: 'Active',
      joiningDate: '2024-01-01',
    },
  });

  // 5. System Users (Admin + Staff)
  await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash: adminPasswordHash,
      fullName: 'Administrator',
      role: 'ADMIN',
      status: 'ACTIVE',
      email: 'admin@rwa-block12.org',
      contactNumber: '+92 300 8219401',
    },
  });

  await prisma.user.create({
    data: {
      username: 'staff',
      passwordHash: staffPasswordHash,
      fullName: 'Nasir Mahmood',
      role: 'COLLECTION_STAFF',
      status: 'ACTIVE',
      staffId: staff1.id,
      email: 'nasir@rwa-block12.org',
      contactNumber: '+92 321 5123456',
    },
  });

  console.log('Demo database reset completed.');
}

// Only execute when run directly via CLI (npm run db:reset-demo)
if (process.argv[1] && (process.argv[1].endsWith('reset-demo.ts') || process.argv[1].endsWith('reset-demo.js'))) {
  resetDemoDatabase()
    .catch((e) => {
      console.error('Reset error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
