import { prisma } from '../db';
import { generateChallanPdfBuffer } from './serverPdfGenerator';
import { sendChallanViaWhatsApp, normalizePhoneNumber } from './whatsappService';
import { logActivity } from './logger';

function getMonthKey(monthName: string, year: number): string {
  const m = monthName.toLowerCase();
  let monthNum = '01';
  if (m.includes('jan')) monthNum = '01';
  else if (m.includes('feb')) monthNum = '02';
  else if (m.includes('mar')) monthNum = '03';
  else if (m.includes('apr')) monthNum = '04';
  else if (m.includes('may')) monthNum = '05';
  else if (m.includes('jun')) monthNum = '06';
  else if (m.includes('jul')) monthNum = '07';
  else if (m.includes('aug')) monthNum = '08';
  else if (m.includes('sep')) monthNum = '09';
  else if (m.includes('oct')) monthNum = '10';
  else if (m.includes('nov')) monthNum = '11';
  else if (m.includes('dec')) monthNum = '12';

  return `${year}-${monthNum}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Automatically checks and runs monthly challan generation & WhatsApp delivery
 * when a new billing month starts.
 */
export async function runAutoBillingJob(): Promise<void> {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth();
    const currentMonthName = MONTH_NAMES[currentMonthIndex];
    const monthKey = getMonthKey(currentMonthName, currentYear);
    const fullMonthName = `${currentMonthName} ${currentYear}`;

    // Calculate due date (e.g. 10th of current month)
    const settings = await prisma.associationSettings.findFirst();
    const dueDay = settings?.defaultDueDay || 10;
    const dueMonthStr = String(currentMonthIndex + 1).padStart(2, '0');
    const dueDayStr = String(dueDay).padStart(2, '0');
    const dueDate = `${currentYear}-${dueMonthStr}-${dueDayStr}`;

    // Check active members
    const activeMembers = await prisma.member.findMany({
      where: { status: 'Active' },
    });

    if (activeMembers.length === 0) {
      return;
    }

    // Check how many members already have challans for this month
    const existingChallans = await prisma.challan.findMany({
      where: { monthKey },
    });

    const existingMemberIds = new Set(existingChallans.map((c) => c.memberId));
    const membersNeedingChallan = activeMembers.filter((m) => !existingMemberIds.has(m.id));

    if (membersNeedingChallan.length === 0) {
      // All active members already have challans for this month
      return;
    }

    console.log(`[Auto-Billing] Auto-generating ${membersNeedingChallan.length} monthly challans for ${fullMonthName}...`);

    const currentTotalChallans = await prisma.challan.count();

    const createdChallans = await prisma.$transaction(async (tx) => {
      const generatedList = [];
      let counter = currentTotalChallans;

      for (const member of membersNeedingChallan) {
        counter++;
        const serial = String(counter).padStart(3, '0');
        const challanNumber = `CH-${currentYear}-${currentMonthName.substring(0, 3).toUpperCase()}-${serial}`;

        // Compute arrears
        const previousChallans = await tx.challan.findMany({
          where: {
            memberId: member.id,
            monthKey: { lt: monthKey },
            status: { in: ['Unpaid', 'Partial Paid'] },
          },
        });

        const arrearsAmount = previousChallans.reduce((sum, c) => sum + c.balance, 0);
        const baseAmount = member.monthlyDueAmount;
        const totalAmount = baseAmount + arrearsAmount;

        const created = await tx.challan.create({
          data: {
            challanNumber,
            memberId: member.id,
            month: fullMonthName,
            monthKey,
            year: currentYear,
            dueDate,
            baseAmount,
            arrearsAmount,
            totalAmount,
            paidAmount: 0,
            balance: totalAmount,
            status: 'Unpaid',
            generatedDate: now.toISOString().split('T')[0],
            whatsappStatus: 'PENDING',
          },
          include: { member: true },
        });

        generatedList.push(created);
      }

      return generatedList;
    });

    let sentCount = 0;
    let failedCount = 0;

    for (const ch of createdChallans) {
      const member = ch.member;
      const normalizedPhone = normalizePhoneNumber(member.contactNumber);

      if (!normalizedPhone) {
        await prisma.challan.update({
          where: { id: ch.id },
          data: {
            whatsappStatus: 'FAILED',
            whatsappError: 'Invalid or missing WhatsApp number.',
          },
        });
        failedCount++;
        continue;
      }

      try {
        const pdfBuffer = await generateChallanPdfBuffer(
          {
            id: ch.id,
            challanNumber: ch.challanNumber,
            memberId: member.memberCode,
            memberName: member.fullName,
            houseNumber: member.houseNumber,
            address: member.address,
            month: ch.month,
            dueDate: ch.dueDate,
            totalAmount: ch.totalAmount,
            paidAmount: ch.paidAmount,
            balance: ch.balance,
            status: ch.status,
          },
          {
            fullName: member.fullName,
            contactNumber: member.contactNumber,
            address: member.address,
            plotNumber: member.plotNumber || undefined,
            floors: member.plotNumber ? member.plotNumber.split(',').map((s) => s.trim()) : undefined,
          },
          {
            organizationName: settings?.organizationName || 'Resident Welfare Association',
            address: settings?.address || 'Central Community Center',
            contactNumber: settings?.contactNumber || '+92 51 9260100',
            logoUrl: settings?.logoUrl,
          }
        );

        const waResult = await sendChallanViaWhatsApp({
          recipientPhone: normalizedPhone,
          pdfBuffer,
          challanNumber: ch.challanNumber,
          memberName: member.fullName,
          billingMonth: ch.month,
          totalAmount: ch.totalAmount,
          dueDate: ch.dueDate,
        });

        if (waResult.success && waResult.messageId) {
          await prisma.challan.update({
            where: { id: ch.id },
            data: {
              whatsappStatus: 'SENT',
              whatsappSentAt: new Date(),
              whatsappMessageId: waResult.messageId,
              whatsappError: null,
            },
          });
          sentCount++;
        } else {
          await prisma.challan.update({
            where: { id: ch.id },
            data: {
              whatsappStatus: 'FAILED',
              whatsappError: waResult.error || 'WhatsApp delivery failed.',
            },
          });
          failedCount++;
        }
      } catch (err: any) {
        await prisma.challan.update({
          where: { id: ch.id },
          data: {
            whatsappStatus: 'FAILED',
            whatsappError: err?.message || 'Server error delivering challan.',
          },
        });
        failedCount++;
      }
    }

    await logActivity({
      user: 'Auto-Billing Service',
      role: 'SYSTEM',
      action: 'Automatic Monthly Challans Dispatched',
      module: 'Billing',
      description: `Auto-generated ${createdChallans.length} challans for ${fullMonthName} (Sent: ${sentCount}, Failed: ${failedCount})`,
    });

    console.log(`[Auto-Billing] Completed auto-generation for ${fullMonthName}: ${sentCount} sent, ${failedCount} failed.`);
  } catch (err) {
    console.error('[Auto-Billing] Job error:', err);
  }
}

/**
 * Initializes the background scheduler (runs check on startup and repeats every 6 hours).
 */
export function startAutoBillingScheduler(): void {
  // Run check 10 seconds after server boot
  setTimeout(() => {
    runAutoBillingJob().catch(console.error);
  }, 10000);

  // Check every 6 hours for month roll-over
  setInterval(() => {
    runAutoBillingJob().catch(console.error);
  }, 6 * 60 * 60 * 1000);

  console.log('[Auto-Billing] Automatic monthly challan scheduler initialized.');
}
