const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  },
  global: {
    headers: {
      'X-Client-Info': 'sip-bridge/1.0'
    }
  }
});

console.log('✅ SIP Bridge চালু হয়েছে...');
console.log('📞 Call request এর জন্য অপেক্ষা করছি...');

function connectRealtime() {
  const channel = supabase
    .channel('call-bridge-' + Date.now())
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'call_queue'
    }, (payload) => {
      console.log('📲 নতুন call request:', payload.new);
      const phone = payload.new.phone_number;
      const status = payload.new.status;
      if (status === 'pending') {
        console.log(`📞 Calling: ${phone}`);
      }
    })
    .subscribe((status, err) => {
      console.log('Supabase status:', status);
      if (err) console.log('Error:', err);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.log('🔄 Reconnecting in 5 seconds...');
        setTimeout(connectRealtime, 5000);
      }
    });
}

connectRealtime();

// Keep alive
setInterval(() => {
  console.log('💓 Heartbeat:', new Date().toISOString());
}, 30000);
