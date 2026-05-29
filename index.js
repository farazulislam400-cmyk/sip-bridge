const { createClient } = require('@supabase/supabase-js');
const dgram = require('dgram');
const crypto = require('crypto');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SIP_SERVER = process.env.SIP_SERVER || '123.0.31.250';
const SIP_PORT = parseInt(process.env.SIP_PORT) || 5060;
const SIP_USER = process.env.SIP_USER || '09644342080';
const SIP_PASS = process.env.SIP_PASS || 'Umm@80S';
const PORT = process.env.PORT || 3000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const udpClient = dgram.createSocket('udp4');

console.log('✅ SIP Bridge চালু হয়েছে...');

// SIP Register
function sendRegister() {
  const branch = 'z9hG4bK' + crypto.randomBytes(8).toString('hex');
  const tag = crypto.randomBytes(8).toString('hex');
  const callId = crypto.randomUUID();

  const register = [
    `REGISTER sip:${SIP_SERVER} SIP/2.0`,
    `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
    `From: <sip:${SIP_USER}@${SIP_SERVER}>;tag=${tag}`,
    `To: <sip:${SIP_USER}@${SIP_SERVER}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 REGISTER`,
    `Contact: <sip:${SIP_USER}@0.0.0.0:5060>`,
    `Expires: 300`,
    `Content-Length: 0`,
    ``,
    ``
  ].join('\r\n');

  udpClient.send(Buffer.from(register), SIP_PORT, SIP_SERVER, (err) => {
    if (err) console.log('❌ Register error:', err.message);
    else console.log('📡 SIP REGISTER sent');
  });
}

// Listen for incoming SIP messages
udpClient.on('message', async (msg) => {
  const message = msg.toString();
  const firstLine = message.split('\r\n')[0];
  console.log('📨 SIP:', firstLine);

  // Incoming INVITE = incoming call
  if (message.startsWith('INVITE')) {
    const fromMatch = message.match(/From:.*sip:([^@>]+)@/);
    const caller = fromMatch ? fromMatch[1] : 'Unknown';
    console.log(`📲 Incoming call from: ${caller}`);

    // Save to Supabase
    await supabase.from('call_queue').insert({
      phone_number: caller,
      status: 'incoming',
      direction: 'inbound'
    });

    // Send 200 OK
    const callIdMatch = message.match(/Call-ID: (.+)/);
    const viaMatch = message.match(/Via: (.+)/);
    const fromHeaderMatch = message.match(/From: (.+)/);
    const toHeaderMatch = message.match(/To: (.+)/);

    if (callIdMatch && viaMatch) {
      const ok = [
        `SIP/2.0 200 OK`,
        `Via: ${viaMatch[1].trim()}`,
        `From: ${fromHeaderMatch ? fromHeaderMatch[1].trim() : ''}`,
        `To: ${toHeaderMatch ? toHeaderMatch[1].trim() : ''}`,
        `Call-ID: ${callIdMatch[1].trim()}`,
        `CSeq: 1 INVITE`,
        `Content-Length: 0`,
        ``,
        ``
      ].join('\r\n');

      udpClient.send(Buffer.from(ok), SIP_PORT, SIP_SERVER);
    }
  }

  // 401 Unauthorized = need auth
  if (message.includes('SIP/2.0 401') || message.includes('SIP/2.0 407')) {
    console.log('🔐 Auth required — sending with credentials...');
    sendRegisterWithAuth(message);
  }

  // 200 OK to REGISTER
  if (message.includes('SIP/2.0 200') && message.includes('REGISTER')) {
    console.log('✅ SIP Registered successfully!');
  }
});

function sendRegisterWithAuth(challenge) {
  const branch = 'z9hG4bK' + crypto.randomBytes(8).toString('hex');
  const tag = crypto.randomBytes(8).toString('hex');
  const callId = crypto.randomUUID();

  // Parse WWW-Authenticate
  const realmMatch = challenge.match(/realm="([^"]+)"/);
  const nonceMatch = challenge.match(/nonce="([^"]+)"/);

  if (!realmMatch || !nonceMatch) return;

  const realm = realmMatch[1];
  const nonce = nonceMatch[1];

  // MD5 digest
  const ha1 = crypto.createHash('md5')
    .update(`${SIP_USER}:${realm}:${SIP_PASS}`).digest('hex');
  const ha2 = crypto.createHash('md5')
    .update(`REGISTER:sip:${SIP_SERVER}`).digest('hex');
  const response = crypto.createHash('md5')
    .update(`${ha1}:${nonce}:${ha2}`).digest('hex');

  const register = [
    `REGISTER sip:${SIP_SERVER} SIP/2.0`,
    `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
    `From: <sip:${SIP_USER}@${SIP_SERVER}>;tag=${tag}`,
    `To: <sip:${SIP_USER}@${SIP_SERVER}>`,
    `Call-ID: ${callId}`,
    `CSeq: 2 REGISTER`,
    `Contact: <sip:${SIP_USER}@0.0.0.0:5060>`,
    `Expires: 300`,
    `Authorization: Digest username="${SIP_USER}",realm="${realm}",nonce="${nonce}",uri="sip:${SIP_SERVER}",response="${response}"`,
    `Content-Length: 0`,
    ``,
    ``
  ].join('\r\n');

  udpClient.send(Buffer.from(register), SIP_PORT, SIP_SERVER, (err) => {
    if (err) console.log('❌ Auth Register error:', err.message);
    else console.log('📡 SIP REGISTER with auth sent');
  });
}

udpClient.bind(5060, () => {
  console.log('🎧 UDP listening on port 5060');
  sendRegister();
  // Re-register every 4 minutes
  setInterval(sendRegister, 240000);
});

// HTTP Server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 HTTP Server on port ${PORT}`);
});

// Outbound polling
let lastChecked = new Date().toISOString();

async function checkCallQueue() {
  try {
    const { data, error } = await supabase
      .from('call_queue')
      .select('*')
      .eq('status', 'pending')
      .gt('created_at', lastChecked)
      .order('created_at', { ascending: true });

    if (error) return;

    if (data && data.length > 0) {
      for (const call of data) {
        console.log(`📲 Outbound call: ${call.phone_number}`);
        lastChecked = call.created_at;

        const branch = 'z9hG4bK' + crypto.randomBytes(8).toString('hex');
        const tag = crypto.randomBytes(8).toString('hex');
        const callId = crypto.randomUUID();

        const invite = [
          `INVITE sip:${call.phone_number}@${SIP_SERVER} SIP/2.0`,
          `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
          `From: <sip:${SIP_USER}@${SIP_SERVER}>;tag=${tag}`,
          `To: <sip:${call.phone_number}@${SIP_SERVER}>`,
          `Call-ID: ${callId}`,
          `CSeq: 1 INVITE`,
          `Contact: <sip:${SIP_USER}@0.0.0.0:5060>`,
          `Content-Type: application/sdp`,
          `Content-Length: 0`,
          ``,
          ``
        ].join('\r\n');

        udpClient.send(Buffer.from(invite), SIP_PORT, SIP_SERVER, async (err) => {
          if (err) {
            await supabase.from('call_queue').update({ status: 'failed' }).eq('id', call.id);
          } else {
            console.log(`📤 INVITE sent: ${call.phone_number}`);
            await supabase.from('call_queue').update({ status: 'calling' }).eq('id', call.id);
          }
        });
      }
    }
  } catch (err) {
    console.log('❌ Exception:', err.message);
  }
}

setInterval(checkCallQueue, 5000);
setInterval(() => console.log('💓 Alive:', new Date().toISOString()), 60000);
console.log('🔄 Polling every 5 seconds...');
