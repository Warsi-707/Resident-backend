import { prisma } from '../db';
import bcrypt from 'bcryptjs';

let dbInitialized = false;

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "memberId" TEXT,
    "staffId" TEXT,
    "email" TEXT,
    "contactNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Member" (
    "id" TEXT NOT NULL,
    "memberCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "houseNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "email" TEXT,
    "plotNumber" TEXT,
    "block" TEXT,
    "monthlyDueAmount" DOUBLE PRECISION NOT NULL DEFAULT 2500,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "joiningDate" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Staff" (
    "id" TEXT NOT NULL,
    "staffCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL DEFAULT 'Collection Staff',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "joiningDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Challan" (
    "id" TEXT NOT NULL,
    "challanNumber" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "dueDate" TEXT NOT NULL,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "arrearsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Unpaid',
    "generatedDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Challan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Payment" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL DEFAULT 'Full Paid',
    "paymentMethod" TEXT NOT NULL DEFAULT 'Cash',
    "referenceNumber" TEXT,
    "relevantMonth" TEXT NOT NULL,
    "collectedById" TEXT,
    "collectedByName" TEXT NOT NULL,
    "collectedByRole" TEXT NOT NULL,
    "notes" TEXT,
    "isVoid" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "challanId" TEXT NOT NULL,
    "allocatedAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Receipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedTo" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssociationSettings" (
    "id" TEXT NOT NULL DEFAULT 'default-settings',
    "organizationName" TEXT NOT NULL DEFAULT 'Resident Welfare Association',
    "address" TEXT NOT NULL DEFAULT 'Central Community Center, Block B, Sector G-11',
    "contactNumber" TEXT NOT NULL DEFAULT '+92 51 9260100',
    "currency" TEXT NOT NULL DEFAULT 'Rs.',
    "defaultDueDay" INTEGER NOT NULL DEFAULT 10,
    "challanFooter" TEXT NOT NULL DEFAULT 'Please pay before the 10th to avoid service interruptions.',
    "receiptFooter" TEXT NOT NULL DEFAULT 'Thank you for your timely contribution towards our community.',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssociationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ActivityLog" (
    "id" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ipAddress" TEXT,
    "timestamp" DOUBLE PRECISION,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "Member_memberCode_key" ON "Member"("memberCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Member_username_key" ON "Member"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "Staff_staffCode_key" ON "Staff"("staffCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Staff_username_key" ON "Staff"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "Challan_challanNumber_key" ON "Challan"("challanNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Challan_memberId_monthKey_key" ON "Challan"("memberId", "monthKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_paymentNumber_key" ON "Payment"("paymentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_receiptNumber_key" ON "Payment"("receiptNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_receiptNumber_key" ON "Receipt"("receiptNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_paymentId_key" ON "Receipt"("paymentId");
`;

export async function ensureDatabaseInitialized() {
  if (dbInitialized) return;

  try {
    // Check if User table exists
    await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1;');
  } catch (err: any) {
    const statements = INIT_SQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (stmtErr: any) {
        // Table or index may already exist, safe to continue
      }
    }
    console.log('[DB-Init] Database schema statements processed.');
  }

  // Ensure default admin always exists with admin123
  try {
    const defaultHash = await bcrypt.hash('admin123', 10);
    await prisma.user.upsert({
      where: { username: 'admin' },
      update: {
        passwordHash: defaultHash,
        status: 'ACTIVE',
      },
      create: {
        username: 'admin',
        passwordHash: defaultHash,
        fullName: 'Administrator',
        role: 'ADMIN',
        status: 'ACTIVE',
        email: 'admin@rwa-block12.org',
        contactNumber: '+92 300 8219401',
      },
    });

    // Ensure default settings exist
    await prisma.associationSettings.upsert({
      where: { id: 'default-settings' },
      update: {},
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

    dbInitialized = true;
    console.log('[DB-Init] Default admin and settings verified.');
  } catch (adminErr: any) {
    console.warn('[DB-Init] Admin auto-setup check:', adminErr.message);
  }
}
