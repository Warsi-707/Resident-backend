/**
 * Generates the standalone WhatsApp QR Code scan page HTML
 * Opens in a new tab for easy mobile scanning without modal or navigation issues.
 */
export function getWhatsAppScanHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect WhatsApp | Resident Welfare Association</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #25D366;
      --primary-dark: #128C7E;
      --primary-hover: #1ebe5a;
      --slate-900: #0f172a;
      --slate-800: #1e293b;
      --slate-700: #334155;
      --slate-600: #475569;
      --slate-500: #64748b;
      --slate-100: #f1f5f9;
      --slate-50: #f8fafc;
      --border: #e2e8f0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #0b141a 0%, #111b21 50%, #0d1f18 100%);
      color: #e9edef;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }

    .container {
      width: 100%;
      max-width: 580px;
      background: rgba(17, 27, 33, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 28px;
      padding: 36px 32px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 40px rgba(37, 211, 102, 0.08);
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #25D366, #128C7E, #25D366);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 18px;
      transition: all 0.3s ease;
    }

    .badge-connecting {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-ready {
      background: rgba(37, 211, 102, 0.15);
      color: #25D366;
      border: 1px solid rgba(37, 211, 102, 0.3);
    }

    .badge-connected {
      background: rgba(37, 211, 102, 0.25);
      color: #25D366;
      border: 1px solid rgba(37, 211, 102, 0.5);
    }

    .badge-error {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 1.8s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.3); }
    }

    h1 {
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
      letter-spacing: -0.5px;
    }

    .subtitle {
      font-size: 13px;
      color: #8696a0;
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .qr-frame {
      position: relative;
      width: 280px;
      height: 280px;
      margin: 0 auto 24px;
      background: #ffffff;
      border-radius: 20px;
      padding: 14px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .qr-frame img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 12px;
      image-rendering: pixelated;
    }

    .qr-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #111b21;
      gap: 12px;
    }

    .spinner {
      width: 44px;
      height: 44px;
      border: 4px solid rgba(18, 140, 126, 0.2);
      border-top-color: #128C7E;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* WhatsApp Web Style Corner Brackets */
    .corner {
      position: absolute;
      width: 20px;
      height: 20px;
      border-color: #25D366;
      pointer-events: none;
    }
    .corner-tl { top: -4px; left: -4px; border-top: 4px solid #25D366; border-left: 4px solid #25D366; border-top-left-radius: 10px; }
    .corner-tr { top: -4px; right: -4px; border-top: 4px solid #25D366; border-right: 4px solid #25D366; border-top-right-radius: 10px; }
    .corner-bl { bottom: -4px; left: -4px; border-bottom: 4px solid #25D366; border-left: 4px solid #25D366; border-bottom-left-radius: 10px; }
    .corner-br { bottom: -4px; right: -4px; border-bottom: 4px solid #25D366; border-right: 4px solid #25D366; border-bottom-right-radius: 10px; }

    /* Steps list */
    .steps-box {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      padding: 16px 20px;
      text-align: left;
      margin-bottom: 24px;
    }

    .steps-title {
      font-size: 12px;
      font-weight: 700;
      color: #25D366;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
      font-size: 13px;
      color: #d1d7db;
      line-height: 1.4;
    }

    .step-item:last-child {
      margin-bottom: 0;
    }

    .step-num {
      width: 22px;
      height: 22px;
      background: #25D366;
      color: #0b141a;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .step-item strong {
      color: #ffffff;
    }

    .actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
      text-decoration: none;
    }

    .btn-primary {
      background: #25D366;
      color: #0b141a;
    }

    .btn-primary:hover {
      background: #1ebe5a;
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #e9edef;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.14);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }

    /* Connected View */
    .connected-card {
      display: none;
      padding: 20px 0;
    }

    .success-icon {
      width: 72px;
      height: 72px;
      background: rgba(37, 211, 102, 0.15);
      color: #25D366;
      border: 2px solid #25D366;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 34px;
      margin: 0 auto 16px;
      animation: bounce 0.6s ease;
    }

    @keyframes bounce {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }

    .connected-number {
      font-size: 20px;
      font-weight: 800;
      color: #25D366;
      font-family: monospace;
      letter-spacing: 1px;
      margin: 8px 0 16px;
    }

    .test-box {
      margin: 20px 0;
      padding: 16px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      gap: 8px;
    }

    .test-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 10px 14px;
      color: #ffffff;
      font-size: 13px;
      outline: none;
    }

    .test-input:focus {
      border-color: #25D366;
    }

    .footer-note {
      margin-top: 24px;
      font-size: 11px;
      color: #667781;
    }
  </style>
</head>
<body>

  <div class="container">
    <!-- Status Badge -->
    <div id="statusBadge" class="badge badge-connecting">
      <span class="pulse-dot"></span>
      <span id="statusText">Connecting WhatsApp...</span>
    </div>

    <!-- Title & Description -->
    <h1>Connect WhatsApp Web</h1>
    <p class="subtitle">
      Resident Welfare Association • Automatic Challan Delivery<br>
      <span style="color:#aebac1; font-size: 12px;">Apne mobile se WhatsApp QR code scan karein aur connect karein</span>
    </p>

    <!-- Scan View (Default) -->
    <div id="scanView">
      <div class="qr-frame">
        <div class="corner corner-tl"></div>
        <div class="corner corner-tr"></div>
        <div class="corner corner-bl"></div>
        <div class="corner corner-br"></div>
        
        <div id="qrPlaceholder" class="qr-placeholder">
          <div class="spinner"></div>
          <span style="font-size:12px; font-weight:600; color:#334155;">QR code generate ho raha hai...</span>
        </div>
        <img id="qrImg" src="" alt="WhatsApp QR" style="display:none;" />
      </div>

      <!-- Instructions Box -->
      <div class="steps-box">
        <div class="steps-title">
          <span>📱</span> Mobile Se Scan Karne Ka Tarika:
        </div>
        <div class="step-item">
          <span class="step-num">1</span>
          <span>Apne phone mein <strong>WhatsApp</strong> open karein</span>
        </div>
        <div class="step-item">
          <span class="step-num">2</span>
          <span>Top right par <strong>3 dots (⋮)</strong> ya iPhone mein <strong>Settings</strong> dabayein</span>
        </div>
        <div class="step-item">
          <span class="step-num">3</span>
          <span><strong>Linked Devices</strong> (منسلک آلات) par tap karein</span>
        </div>
        <div class="step-item">
          <span class="step-num">4</span>
          <span><strong>"Link a Device"</strong> dabayein aur is screen par mojood QR code scan karein</span>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="actions">
        <button id="btnRefresh" class="btn btn-primary" onclick="forceRefreshQR()">
          <span>🔄</span> Refresh QR Code
        </button>
        <button id="btnReconnect" class="btn btn-secondary" onclick="forceReconnect()">
          <span>⚡</span> Reconnect
        </button>
        <a href="/" class="btn btn-secondary">
          <span>🏠</span> Back to App
        </a>
      </div>
    </div>

    <!-- Connected View (Shown when connection is active) -->
    <div id="connectedView" class="connected-card">
      <div class="success-icon">✓</div>
      <h2 style="font-size:22px; font-weight:800; color:#ffffff;">WhatsApp Connected! 🎉</h2>
      <p style="font-size:13px; color:#8696a0; margin-top:4px;">
        Aapka WhatsApp successfully connect ho chuka hai.<br>
        Ab tamam challans aur receipts is number se automatically jayenge.
      </p>

      <div class="connected-number" id="connectedPhone">+92 XXXXXXXXXX</div>

      <!-- Quick Test Message -->
      <div class="test-box">
        <input type="text" id="testPhone" class="test-input" placeholder="03XXXXXXXXX (Test number)" />
        <button class="btn btn-primary" onclick="sendTestMessage()" id="btnSendTest">
          Send Test
        </button>
      </div>
      <div id="testStatus" style="font-size:12px; margin-bottom:14px; display:none;"></div>

      <div class="actions">
        <button class="btn btn-secondary" onclick="window.close()">
          <span>✕</span> Close This Tab
        </button>
        <a href="/" class="btn btn-secondary">
          <span>🏠</span> Go to Dashboard
        </a>
        <button class="btn btn-danger" onclick="disconnectWA()">
          <span>🔌</span> Disconnect
        </button>
      </div>
    </div>

    <div class="footer-note">
      End-to-End Encrypted via WhatsApp Baileys • Safe & Private
    </div>
  </div>

  <script>
    let pollInterval = null;
    let isConnected = false;

    function getAuthToken() {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('token') || localStorage.getItem('rwa_token') || '';
    }

    async function checkStatus() {
      try {
        const token = getAuthToken();
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch('/api/whatsapp/live-status', { headers });
        if (!res.ok) return;

        const data = await res.json();
        renderState(data);
      } catch (err) {
        console.error('Status check error:', err);
      }
    }

    function renderState(data) {
      const scanView = document.getElementById('scanView');
      const connectedView = document.getElementById('connectedView');
      const badge = document.getElementById('statusBadge');
      const statusText = document.getElementById('statusText');
      const qrImg = document.getElementById('qrImg');
      const qrPlaceholder = document.getElementById('qrPlaceholder');

      if (data.connected) {
        isConnected = true;
        scanView.style.display = 'none';
        connectedView.style.display = 'block';

        badge.className = 'badge badge-connected';
        statusText.textContent = 'Active & Connected';
        document.getElementById('connectedPhone').textContent = data.phoneNumber ? '+' + data.phoneNumber : 'Active';
      } else {
        isConnected = false;
        scanView.style.display = 'block';
        connectedView.style.display = 'none';

        if (data.qrCode) {
          badge.className = 'badge badge-ready';
          statusText.textContent = 'Scan QR Code with Phone';
          qrImg.src = data.qrCode;
          qrImg.style.display = 'block';
          qrPlaceholder.style.display = 'none';
        } else if (data.connecting) {
          badge.className = 'badge badge-connecting';
          statusText.textContent = 'Generating QR Code...';
          qrImg.style.display = 'none';
          qrPlaceholder.style.display = 'flex';
        } else {
          badge.className = 'badge badge-connecting';
          statusText.textContent = 'Initializing WhatsApp...';
          qrImg.style.display = 'none';
          qrPlaceholder.style.display = 'flex';
        }

        if (data.lastError) {
          console.warn('WhatsApp last error:', data.lastError);
        }
      }
    }

    async function forceRefreshQR() {
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;

      try {
        document.getElementById('statusText').textContent = 'Refreshing QR...';
        await fetch('/api/whatsapp/connect', { method: 'POST', headers });
        await checkStatus();
      } catch (err) {
        console.error('Refresh error:', err);
      }
    }

    async function forceReconnect() {
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;

      try {
        document.getElementById('statusText').textContent = 'Reconnecting socket...';
        await fetch('/api/whatsapp/reconnect', { method: 'POST', headers });
        await checkStatus();
      } catch (err) {
        console.error('Reconnect error:', err);
      }
    }

    async function disconnectWA() {
      if (!confirm('Kya aap waqai WhatsApp disconnect karna chahte hain?')) return;
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;

      try {
        await fetch('/api/whatsapp/disconnect', { method: 'POST', headers });
        await checkStatus();
      } catch (err) {
        console.error('Disconnect error:', err);
      }
    }

    async function sendTestMessage() {
      const phoneInput = document.getElementById('testPhone');
      const phone = phoneInput.value.trim();
      const statusDiv = document.getElementById('testStatus');
      const btn = document.getElementById('btnSendTest');

      if (!phone) {
        alert('Barah-e-karam phone number daalen (e.g. 03001234567)');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Sending...';
      statusDiv.style.display = 'block';
      statusDiv.style.color = '#fbbf24';
      statusDiv.textContent = 'Test message bheja ja raha hai...';

      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      try {
        const res = await fetch('/api/whatsapp/test', {
          method: 'POST',
          headers,
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success) {
          statusDiv.style.color = '#25D366';
          statusDiv.textContent = '✅ Test message kamyabi se chala gaya!';
        } else {
          statusDiv.style.color = '#f87171';
          statusDiv.textContent = '❌ Error: ' + (data.error || 'Message nahi ja saka');
        }
      } catch (err) {
        statusDiv.style.color = '#f87171';
        statusDiv.textContent = '❌ Error: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send Test';
      }
    }

    // Initialize
    checkStatus();
    pollInterval = setInterval(checkStatus, 1500);

    // Auto-trigger connect if nothing happens after 2s
    setTimeout(() => {
      if (!isConnected) {
        forceRefreshQR();
      }
    }, 2000);
  </script>
</body>
</html>`;
}
