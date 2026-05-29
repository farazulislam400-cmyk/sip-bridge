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

console.log('✅ SIP Bridge চালু হয়েছে...');

// HTTP Server — incoming SIP notify এর জন্য
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/incoming') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        console.log('📲 Incoming call:', data.from);
        
        await supabase.from('call_queue').insert({
          phone_number: data.from,
          status: 'incoming',
          direction: 'inbound'
        });
        
        res.writeHead(200);
        res.end('OK');
      } catch(e) {
        res.writeHead(400);
        res.end('Error');
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
});

// Outbound call function
function makeCall(phone, callId) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const callIdStr = crypto.randomUUID();
    const tag = crypto.randomBytes(8).toString('hex');
    const branch = 'z9hG4bK' + crypto.randomBytes(8).toString('hex');

    const invite = [
      `INVITE sip:${phone}@${SIP_SERVER} SIP/2.0`,
      `Via: SIP/2.0/UDP 0.0.0.0:5060;branch=${branch}`,
      `From: <sip:${SIP_USER}@${SIP_SERVER}>;tag=${tag}`,
      `To: <sip:${phone}@${SIP_SERVER}>`,
      `Call-ID: ${callIdStr}`,
      `CSeq: 1 INVITE`,
      `Contact: <sip:${SIP_USER}@0.0.0.0:5060>`,
      `Content-Type: application/sdp`,
      `Content-Length: 0`,
      ``,
      ``
    ].join('\r\n');

    const msg = Buffer.from(invite);

    client.on('message', async (response) => {
      const res = response.toString();
      console.log(`📱 SIP Response: ${res.split('\r\n')[0]}`);
      if (res.includes('SIP/2.0 200') || res.includes('SIP/2.0 180')) {
        await supabase.from('call_queue').update({ status: 'calling' }).eq('id', callId);
      } else if (res.includes('SIP/2.0 4') || res.includes('SIP/2.0 5')) {
        await supabase.from('call_queue').update({ status: 'failed' }).eq('id', callId);
      }
      client.close();
      resolve();
    });

    client.on('error', (err) => {
      console.log('❌ UDP Error:', err.message);
      client.close();
      resolve();
    });

    client.send(msg, SIP_PORT, SIP_SERVER, async (err) => {
      if (err) {
        console.log('❌ Send error:', err.message);
        await supabase.from('call_queue').update({ status: 'failed' }).eq('id', callId);
        client.close();
        resolve();
      } else {
        console.log(`📤 SIP INVITE sent to ${phone}`);
      }
    });

    setTimeout(() => {
      try { client.close(); } catch(e) {}
      resolve();
    }, 10000);
  });
}

// Polling
let lastChecked = new Date().toISOString();

async function checkCallQueue() {
  try {
    const { data, error } = await supabase
      .from('call_queue')
      .select('*')
      .eq('status', 'pending')
      .gt('created_at', lastChecked)
      .order('created_at', { ascending: true });

    if (error) { console.log('❌ Error:', error.message); return; }

    if (data && data.length > 0) {
      for (const call of data) {
        console.log(`📲 নতুন call: ${call.phone_number}`);
        lastChecked = call.created_at;
        await makeCall(call.phone_number, call.id);
      }
    }
  } catch (err) {
    console.log('❌ Exception:', err.message);
  }
}

setInterval(checkCallQueue, 5000);
setInterval(() => { console.log('💓 Alive:', new Date().toISOString()); }, 60000);
console.log('🔄 Polling every 5 seconds...');
