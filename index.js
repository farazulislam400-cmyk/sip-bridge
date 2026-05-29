const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('✅ SIP Bridge চালু হয়েছে (Polling mode)...');

let lastChecked = new Date().toISOString();

async function checkCallQueue() {
  try {
    const { data, error } = await supabase
      .from('call_queue')
      .select('*')
      .eq('status', 'pending')
      .gt('created_at', lastChecked)
      .order('created_at', { ascending: true });

    if (error) {
      console.log('❌ Error:', error.message);
      return;
    }

    if (data && data.length > 0) {
      for (const call of data) {
        console.log(`📲 নতুন call: ${call.phone_number}`);
        lastChecked = call.created_at;
        
        // Update status to 'calling'
        await supabase
          .from('call_queue')
          .update({ status: 'calling' })
          .eq('id', call.id);
          
        console.log(`✅ Call queued: ${call.phone_number}`);
      }
    }
  } catch (err) {
    console.log('❌ Exception:', err.message);
  }
}

// প্রতি ৫ সেকেন্ডে check
setInterval(checkCallQueue, 5000);

// Heartbeat
setInterval(() => {
  console.log('💓 Alive:', new Date().toISOString());
}, 60000);

console.log('🔄 Polling every 5 seconds...');
