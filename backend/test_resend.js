import https from 'https';

function sendResendEmail({ apiKey, from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: from || 'OWMS Onboarding <onboarding@resend.dev>',
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
          console.log('✅ Resend HTTPS Email Sent Successfully:', body);
          resolve(JSON.parse(body));
        } else {
          console.error('❌ Resend HTTPS API Error:', res.statusCode, body);
          reject(new Error(`Resend API Error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', err => {
      console.error('❌ HTTPS Request Error:', err.message);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTPS Request Timed Out'));
    });

    req.write(data);
    req.end();
  });
}

// Test with a key if available
console.log('Resend HTTPS Email Helper Ready');
