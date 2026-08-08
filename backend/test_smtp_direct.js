import nodemailer from 'nodemailer';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

async function testGmail1() {
  console.log('Testing Method 1: host: smtp.gmail.com, port: 465, secure: true');
  const transporter1 = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'mnareshkumar299@gmail.com',
      pass: 'gajh hpqj pbuw daln',
    },
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });

  try {
    const info = await transporter1.sendMail({
      from: '"OWMS Test" <mnareshkumar299@gmail.com>',
      to: 'mnareshkumar299@gmail.com',
      subject: 'OWMS Live SMTP Test - Method 1 (Port 465)',
      text: 'Hello Naresh! This is a test email from OWMS via Port 465 SSL.',
    });
    console.log('✅ Method 1 Success! Message ID:', info.messageId);
    return true;
  } catch (err) {
    console.error('❌ Method 1 Failed:', err.message);
    return false;
  }
}

async function testGmail2() {
  console.log('\nTesting Method 2: service: "gmail"');
  const transporter2 = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'mnareshkumar299@gmail.com',
      pass: 'gajh hpqj pbuw daln',
    },
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });

  try {
    const info = await transporter2.sendMail({
      from: '"OWMS Test" <mnareshkumar299@gmail.com>',
      to: 'mnareshkumar299@gmail.com',
      subject: 'OWMS Live SMTP Test - Method 2 (Service Gmail)',
      text: 'Hello Naresh! This is a test email from OWMS via service: gmail.',
    });
    console.log('✅ Method 2 Success! Message ID:', info.messageId);
    return true;
  } catch (err) {
    console.error('❌ Method 2 Failed:', err.message);
    return false;
  }
}

async function main() {
  const r1 = await testGmail1();
  if (!r1) {
    await testGmail2();
  }
}

main();
