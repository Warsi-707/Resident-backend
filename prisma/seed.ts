import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seedDatabase() {
  console.log('Running non-destructive database seed (idempotent setup)...');

  // 1. Encrypt default credentials
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const staffPasswordHash = await bcrypt.hash('staff123', 10);

  // 2. Default Association Settings (Upsert - create if missing, keep existing if present)
  await prisma.associationSettings.upsert({
    where: { id: 'default-settings' },
    update: {}, // Non-destructive: do not overwrite existing customized settings
    create: {
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

  // 3. Default Staff Profile (Upsert - create if missing)
  const staff1 = await prisma.staff.upsert({
    where: { username: 'staff' },
    update: {}, // Non-destructive: preserve existing staff data
    create: {
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

  // 4. Default Admin User (Upsert - create if missing)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {}, // Non-destructive: preserve existing admin account
    create: {
      username: 'admin',
      passwordHash: adminPasswordHash,
      fullName: 'Administrator',
      role: 'ADMIN',
      status: 'ACTIVE',
      email: 'admin@rwa-block12.org',
      contactNumber: '+92 300 8219401',
    },
  });

  // 5. Default Staff User (Upsert - create if missing)
  await prisma.user.upsert({
    where: { username: 'staff' },
    update: {}, // Non-destructive: preserve existing staff user account
    create: {
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

  console.log('Non-destructive seed completed successfully. All existing operational data preserved.');
}

// Only execute when run directly via CLI (e.g. npm run db:seed)
if (process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'))) {
  seedDatabase()
    .catch((e) => {
      console.error('Seed error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
