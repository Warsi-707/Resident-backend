import app from './src/app';
import { startAutoBillingScheduler } from './src/utils/autoBillingCron';
import { connectWhatsApp } from './src/utils/baileysBridge';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 RWA Backend Server running on http://localhost:${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health\n`);

  // Local-only background services
  if (!process.env.VERCEL) {
    startAutoBillingScheduler();
    connectWhatsApp().catch((err) => {
      console.warn('[WhatsApp] Auto-connect failed (library may not be installed yet):', err.message);
    });
  }
});
