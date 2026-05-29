const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('✅ SIP Bridge চালু হয়েছে...');
console.log('📞 Call request এর জন্য অপেক্ষা করছি...');

supabase
  .channel('call-bridge')
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
  .subscribe((status) => {
    console.log('Supabase status:', status);
  });
