import nodemailer from 'nodemailer';
import dns from 'dns';
import https from 'https';
import Settings from '../models/Settings.js';

// Force IPv4 resolution first to prevent ENETUNREACH IPv6 errors on cloud platforms like Render
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

// HTTPS API Fallback for cloud providers (like Render) that block outbound SMTP ports (25, 465, 587)
function sendViaResendApi({ to, subject, html, fromName }) {
  let apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return Promise.reject(new Error('RESEND_API_KEY not set'));
  apiKey = apiKey.trim().replace(/^["']|["']$/g, '');

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: `${fromName || 'OWMS Notifications'} <onboarding@resend.dev>`,
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: html,
    });

    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Resend API ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Resend HTTPS Timeout'));
    });

    req.write(data);
    req.end();
  });
}

function sendViaBrevoApi({ to, subject, html, fromName, fromEmail }) {
  let apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return Promise.reject(new Error('BREVO_API_KEY not set'));
  apiKey = apiKey.trim().replace(/^["']|["']$/g, '');

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      sender: {
        name: fromName || 'OWMS Notifications',
        email: fromEmail || process.env.EMAIL_USER || 'mnareshkumar299@gmail.com',
      },
      to: (Array.isArray(to) ? to : [to]).map(e => ({ email: e })),
      subject: subject,
      htmlContent: html,
    });

    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Brevo API ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Brevo HTTPS Timeout'));
    });

    req.write(data);
    req.end();
  });
}

async function sendViaHttpsApi({ to, subject, html, fromName, fromEmail }) {
  if (process.env.BREVO_API_KEY) {
    return sendViaBrevoApi({ to, subject, html, fromName, fromEmail });
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResendApi({ to, subject, html, fromName });
  }
  throw new Error('No HTTPS API Key configured');
}

/**
 * Email delivery: ONE SMTP connection, THREE sender identities.
 *
 *   onboarding → welcome emails for new users
 *   alerts     → project assignments, task & system notifications
 *   support    → password reset & helpline (gets a monitored Reply-To)
 *
 * SMTP + identities are read from Admin → Settings (the `notifications` block),
 * falling back to the EMAIL_* environment variables when the DB isn't configured.
 * Settings are cached for 60s so we don't hit the DB on every send.
 *
 * Note on Gmail: smtp.gmail.com forces the From *address* to the authenticated
 * account. The per-identity display name and Reply-To are still honoured, so
 * recipients see "OWMS Support", "OWMS Alerts", etc. with the right reply target.
 */

let _cache = { at: 0, notif: null };

// Welcome-email pooled transporter (reused across calls)
let _transporter = null;
let _transporterConfig = null;

async function getNotifSettings() {
  if (_cache.notif && Date.now() - _cache.at < 60_000) return _cache.notif;
  try {
    const s = await Settings.findOne({ key: 'global' })
      .select('+notifications.smtpPass')
      .lean();
    _cache = { at: Date.now(), notif: s?.notifications || null };
  } catch {
    _cache = { at: Date.now(), notif: null };
  }
  return _cache.notif;
}

// Invalidate the cache when settings change (called from the settings controller)
export function invalidateMailCache() {
  _cache = { at: 0, notif: null };
  // Also reset the pooled welcome-email transporter
  _transporter = null;
  _transporterConfig = null;
}

// The .env SMTP is the source of truth for the connection (deployment secret).
// The DB SMTP fields are only used as a fallback when .env isn't configured —
// this prevents a stale/wrong value saved in the Settings UI from overriding a
// working .env account.
function envSmtpReady() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_PASS);
}
function dbSmtpReady(n) {
  return !!(n?.smtpHost && n?.smtpPass);
}

// Which SMTP connection is actually being used, and the account address on it.
function activeSmtp(n) {
  if (envSmtpReady()) {
    return { source: 'env', accountEmail: process.env.EMAIL_USER };
  }
  if (dbSmtpReady(n)) {
    return { source: 'db', accountEmail: n.smtpUser || n.fromEmail };
  }
  // Nothing fully configured — fall through to env so the error is explicit.
  return { source: 'env', accountEmail: process.env.EMAIL_USER };
}

function buildTransporter(n) {
  const active = activeSmtp(n);
  let host, port, user, pass, encryption;
  if (active.source === 'db') {
    host = n.smtpHost;
    port = n.smtpPort;
    user = n.smtpUser;
    pass = n.smtpPass;
    encryption = n.smtpEncryption;
  } else {
    host = process.env.EMAIL_HOST;
    port = process.env.EMAIL_PORT;
    user = process.env.EMAIL_USER;
    pass = process.env.EMAIL_PASS;
    encryption = process.env.EMAIL_ENCRYPTION;
  }

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials incomplete. Please check host, username, and password.');
  }

  const isGmail = (host || '').toLowerCase().includes('gmail');
  const isSSL = encryption === 'SSL' || Number(port) === 465;

  const transportOpts = {
    auth:              { user, pass },
    family:            4,
    connectionTimeout: 15000,
    greetingTimeout:   10000,
    socketTimeout:     20000,
  };

  if (isGmail) {
    transportOpts.service = 'gmail';
  } else {
    transportOpts.host   = host;
    transportOpts.port   = Number(port) || (isSSL ? 465 : 587);
    transportOpts.secure = isSSL;
  }

  return nodemailer.createTransport(transportOpts);
}

const ENV_FALLBACKS = {
  onboarding: { name: process.env.EMAIL_ONBOARDING_NAME || 'OWMS Onboarding', replyTo: '' },
  alerts:     { name: process.env.EMAIL_ALERTS_NAME     || 'OWMS Alerts',     replyTo: '' },
  support:    { name: process.env.EMAIL_SUPPORT_NAME    || 'OWMS Support',    replyTo: process.env.EMAIL_SUPPORT_REPLY_TO || '' },
};

// Resolve { from, replyTo } for a given identity type against the settings doc.
function resolveSender(type, n) {
  const accountEmail  = activeSmtp(n).accountEmail;
  const globalName    = n?.fromName  || 'OWMS';
  const globalEmail   = n?.fromEmail || accountEmail || '';
  const fb            = ENV_FALLBACKS[type] || {};

  const id = {
    onboarding: { name: n?.onboardingFromName, email: n?.onboardingFromEmail, replyTo: n?.onboardingReplyTo },
    alerts:     { name: n?.alertsFromName,     email: n?.alertsFromEmail,     replyTo: n?.alertsReplyTo },
    support:    { name: n?.supportFromName,    email: n?.supportFromEmail,    replyTo: n?.supportReplyTo },
  }[type] || {};

  const name    = id.name    || fb.name   || globalName;
  const email   = id.email   || globalEmail;
  const replyTo = id.replyTo || fb.replyTo || undefined;

  return { from: `"${name}" <${email}>`, replyTo };
}

// Build everything needed to send as a given identity.
async function mailerFor(type) {
  const n = await getNotifSettings();
  return { transporter: buildTransporter(n), ...resolveSender(type, n) };
}

/**
 * Low-level send used by the Settings "Send Test Email" button.
 * Verifies the active SMTP connection (DB or env) using a chosen identity.
 */
export async function sendTestEmail({ to, identity = 'support' }) {
  if (process.env.BREVO_API_KEY || process.env.RESEND_API_KEY) {
    try {
      await sendViaHttpsApi({
        to,
        subject: 'OWMS — Test Email (HTTPS)',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#2563EB">OWMS Test Email (HTTPS)</h2>
            <p>Your HTTPS API email configuration is working correctly.</p>
            <p><strong>Sent to:</strong> ${to}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
            <hr/>
            <p style="font-size:12px;color:#64748B">Movi Cloud Labs — OWMS Notification System</p>
          </div>
        `,
      });
      return;
    } catch (e) {
      console.warn('HTTPS API mailer failed, falling back to SMTP:', e.message);
    }
  }

  try {
    const { transporter, from, replyTo } = await mailerFor(identity);
    await transporter.sendMail({
      from,
      replyTo,
      to,
      subject: 'OWMS — Test Email',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#2563EB">OWMS Test Email</h2>
          <p>Your SMTP configuration is working correctly.</p>
          <p><strong>Sender identity:</strong> ${identity}</p>
          <p><strong>Sent to:</strong> ${to}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <hr/>
          <p style="font-size:12px;color:#64748B">Movi Cloud Labs — OWMS Notification System</p>
        </div>
      `,
    });
  } catch (err) {
    if (process.env.RESEND_API_KEY) {
      await sendViaResendApi({
        to,
        subject: 'OWMS — Test Email (Fallback)',
        html: `<p>Test email delivered via HTTPS API fallback.</p>`,
      });
      return;
    }
    throw err;
  }
}

export const sendProjectAssignmentEmail = async ({
  to, employeeName, projectName, projectCode, role, pmoName, hrName, loginUrl = 'https://owms-frontend.onrender.com',
}) => {
  const assignmentHtml = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#fff;border:1px solid #E2E8F0;border-radius:12px">
      <div style="background:#2563EB;border-radius:8px;padding:20px 24px;margin-bottom:28px">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:-0.3px">OWMS</h1>
        <p style="color:#93C5FD;margin:4px 0 0;font-size:13px">Office Workspace Management System</p>
      </div>

      <h2 style="color:#0F172A;font-size:18px;font-weight:600;margin:0 0 8px">Project Assignment</h2>
      <p style="color:#64748B;font-size:14px;margin:0 0 24px;line-height:1.6">
        Hi ${employeeName}, you have been assigned to an isolated project team.
      </p>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;color:#64748B;font-size:13px">Project Name</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600;color:#0F172A">${projectName} (${projectCode || 'N/A'})</td>
          </tr>
          <tr style="border-top:1px solid #E2E8F0">
            <td style="padding:8px 0;color:#64748B;font-size:13px">Assigned Role</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600;color:#0F172A">${role}</td>
          </tr>
          <tr style="border-top:1px solid #E2E8F0">
            <td style="padding:8px 0;color:#64748B;font-size:13px">Reporting Manager</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600;color:#0F172A">${pmoName} (PMO Lead)</td>
          </tr>
          ${hrName ? `
          <tr style="border-top:1px solid #E2E8F0">
            <td style="padding:8px 0;color:#64748B;font-size:13px">Reporting HR</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600;color:#0F172A">${hrName}</td>
          </tr>` : ''}
        </table>
      </div>

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px 16px;margin-bottom:24px">
        <p style="color:#1D4ED8;font-size:13px;margin:0">
          You are now part of an isolated project team. Your work is scoped exclusively to this project until it is completed or you are reassigned.
        </p>
      </div>

      <a href="${loginUrl}/login" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600">
        Go to Dashboard
      </a>

      <p style="color:#94A3B8;font-size:12px;margin:24px 0 0;text-align:center">
        This is an automated message from OWMS. Please do not reply to this email.
      </p>
    </div>
  `;

  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResendApi({ to, subject: `You've been assigned to project ${projectName}`, html: assignmentHtml });
      return;
    } catch (e) {
      console.warn('Project assignment email via Resend failed, trying SMTP:', e.message);
    }
  }

  const { transporter, from, replyTo } = await mailerFor('alerts');
  await transporter.sendMail({
    from, replyTo, to,
    subject: `You've been assigned to project ${projectName}`,
    html: assignmentHtml,
  });
};

export const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  const resetHtml = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#fff;border:1px solid #E2E8F0;border-radius:12px">
      <div style="background:#2563EB;border-radius:8px;padding:20px 24px;margin-bottom:28px">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:-0.3px">OWMS</h1>
        <p style="color:#93C5FD;margin:4px 0 0;font-size:13px">Office Workspace Management System</p>
      </div>

      <h2 style="color:#0F172A;font-size:18px;font-weight:600;margin:0 0 8px">Reset your password</h2>
      <p style="color:#64748B;font-size:14px;margin:0 0 24px;line-height:1.6">
        Hi ${name}, we received a request to reset the password for your account.
        Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.
      </p>

      <a href="${resetUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:24px">
        Reset Password
      </a>

      <p style="color:#64748B;font-size:13px;margin:24px 0 8px;line-height:1.6">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:10px 12px;font-size:12px;color:#2563EB;word-break:break-all;margin:0 0 24px">
        ${resetUrl}
      </p>

      <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px 16px;margin-bottom:24px">
        <p style="color:#92400E;font-size:13px;margin:0">
          <strong>Didn't request this?</strong> You can safely ignore this email — your password will not change.
        </p>
      </div>

      <p style="color:#94A3B8;font-size:12px;margin:0;text-align:center">
        Need help? Reply to this email to reach the OWMS support team.
      </p>
    </div>
  `;

  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResendApi({ to, subject: 'Reset your OWMS password', html: resetHtml });
      return;
    } catch (e) {
      console.warn('Reset email via Resend failed, trying SMTP:', e.message);
    }
  }

  const { transporter, from, replyTo } = await mailerFor('support');
  await transporter.sendMail({
    from, replyTo, to,
    subject: 'Reset your OWMS password',
    html: resetHtml,
  });
};

// ─── Pooled Welcome-Email Transporter ─────────────────────────────────────────

const getWelcomeConfigKey = (n) =>
  `${n?.smtpHost || process.env.EMAIL_HOST}:${n?.smtpPort || process.env.EMAIL_PORT}:${n?.smtpUser || process.env.EMAIL_USER}`;

const getWelcomeTransporter = async () => {
  const n = await getNotifSettings();

  const host = n?.smtpHost || process.env.EMAIL_HOST;
  const user = n?.smtpUser || process.env.EMAIL_USER;
  const pass = n?.smtpPass || process.env.EMAIL_PASS;

  if (!host || !pass) {
    return { transporter: null, settings: n, error: 'SMTP not configured' };
  }

  const currentKey = getWelcomeConfigKey(n);

  // Reuse existing transporter if settings haven't changed
  if (_transporter && _transporterConfig === currentKey) {
    return { transporter: _transporter, settings: n };
  }

  const isGmail = (host || '').toLowerCase().includes('gmail');
  const isSSL = n?.smtpEncryption === 'SSL' || Number(n?.smtpPort || process.env.EMAIL_PORT) === 465;

  const transportOpts = {
    auth:             { user, pass },
    family:           4,         // IPv4 force for cloud platforms like Render
    pool:             true,      // reuse the same SMTP connection
    maxConnections:   1,         // one connection, no parallel sends
    maxMessages:      Infinity,
    rateDelta:        1000,      // 1 second between emails
    rateLimit:        1,         // max 1 email per rateDelta (Gmail safe)
    connectionTimeout: 15000,
    greetingTimeout:   10000,
    socketTimeout:     20000,
  };

  if (isGmail) {
    transportOpts.service = 'gmail';
  } else {
    transportOpts.host   = host;
    transportOpts.port   = n?.smtpPort || Number(process.env.EMAIL_PORT) || (isSSL ? 465 : 587);
    transportOpts.secure = isSSL;
  }

  _transporter = nodemailer.createTransport(transportOpts);

  _transporterConfig = currentKey;

  try {
    await _transporter.verify();
  } catch (err) {
    console.error('SMTP verify failed:', err.message);
    _transporter = null;
    _transporterConfig = null;
    return { transporter: null, settings: n, error: err.message };
  }

  return { transporter: _transporter, settings: n };
};

export const sendWelcomeEmail = async ({
  toEmail, toName, employeeId,
  tempPassword, role,
  loginUrl = 'https://owms-frontend.onrender.com/login',
}) => {
  const welcomeHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#F8FAFC;padding:32px;">
      <div style="background:#1E293B;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:white;margin:0;font-size:24px;">OWMS</h1>
        <p style="color:#94A3B8;margin:4px 0 0;">Office Workspace Management System</p>
      </div>
      <div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #E2E8F0;">
        <h2 style="color:#0F172A;">Welcome, ${toName}!</h2>
        <p style="color:#64748B;">Your account has been created on OWMS by Movi Cloud Labs. Here are your login credentials:</p>
        <div style="background:#F1F5F9;padding:20px;border-radius:8px;margin:24px 0;border-left:4px solid #2563EB;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#64748B;width:150px;">Employee ID:</td>
              <td style="padding:8px 0;font-weight:bold;color:#0F172A;font-family:monospace;">${employeeId}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748B;">Email:</td>
              <td style="padding:8px 0;font-weight:bold;color:#0F172A;font-family:monospace;">${toEmail}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748B;">Role:</td>
              <td style="padding:8px 0;font-weight:bold;color:#0F172A;">${role}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748B;">Temp Password:</td>
              <td style="padding:8px 0;font-weight:bold;color:#2563EB;font-family:monospace;font-size:18px;">${tempPassword}</td>
            </tr>
          </table>
        </div>
        <p style="color:#DC2626;font-size:14px;">⚠ Please change your password immediately after your first login.</p>
        <a href="${loginUrl}" style="display:inline-block;background:#2563EB;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px;">Login to OWMS →</a>
      </div>
    </div>
  `;

  if (process.env.BREVO_API_KEY || process.env.RESEND_API_KEY) {
    try {
      await sendViaHttpsApi({
        to: toEmail,
        subject: 'Welcome to OWMS — Your Account is Ready',
        html: welcomeHtml,
      });
      return { sent: true };
    } catch (e) {
      console.warn('Welcome email via HTTPS API failed, trying SMTP:', e.message);
    }
  }

  try {
    const { transporter, settings, error } = await getWelcomeTransporter();

    if (!transporter) {
      console.warn('Welcome email skipped:', error || 'SMTP not configured');
      return { sent: false, reason: error || 'SMTP not configured' };
    }

    const fromName  = settings?.fromName  || 'OWMS Notifications';
    const fromEmail = settings?.fromEmail || process.env.EMAIL_USER || 'noreply@movicloudlabs.com';

    await transporter.sendMail({
      from:    `"${fromName}" <${fromEmail}>`,
      to:      toEmail,
      subject: 'Welcome to OWMS — Your Account is Ready',
      html:    welcomeHtml,
    });

    return { sent: true };
  } catch (err) {
    console.error('Welcome email failed:', err.message);
    // Reset transporter on error so next call creates a fresh connection
    _transporter = null;
    _transporterConfig = null;
    return { sent: false, reason: err.message };
  }
};

// Export for settings changes and test endpoints
export const resetTransporter = () => {
  _transporter = null;
  _transporterConfig = null;
};
