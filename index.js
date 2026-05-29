const { createClient } = require('@supabase/supabase-js');
const SipClient = require('sip');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SIP_SERVER = process.env.SIP_SERVER || '123.0.31.250';
const SIP_PORT = process.env.SIP_PORT || '5060';
const SIP_USER = process.env.SIP_USER || '09644342080';
const SIP_PASS = process.env.SIP_PASS || 'Umm@80S';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('✅ SIP Bridge চালু হয়েছে...');

let lastChecked = new Date().toISOString();

async function makeCall(phone, callId) {
  console.log(`📞 Calling: ${phone}`);
  
  // SIP INVITE
  const callUri = `sip:${phone}@${SIP_SERVER}`;
  const fromUri = `sip:${SIP_USER}@${SIP_SERVER}`;
  
  SipClient.send({
    method: 'INVITE',
    uri: callUri,
    headers: {
      to: { uri: callUri },
      from: { uri: fromUri, params: { tag: Math.random().toString(36) } },
      'call-id': callId,
      cseq: { method: 'INVITE', seq: 1 },
      'content-type': 'application/sdp',
      contact: [{ uri: fromUri }],
      via: []
    },
    content: `v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=call\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 0 RTP/AVP 0\r\n`
  }, async (rs) => {
    if (rs && rs.status) {
      console.log(`📱 SIP Response: ${rs.status.code} ${rs.status.reason}`);
      if (rs.status.code === 200) {
        await supabase.from('call_queue').update({ status: 'completed' }).eq('id', callId);
      } else if (rs.status.code >= 400) {
        await supabase.from('call_queue').update({ status: 'failed', error_message: rs.status.reason }).eq('id', callId);
      }
    }
  });
  
  await supabase.from('call_queue').update({ status: 'calling' }).eq('id', callId);
}

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
