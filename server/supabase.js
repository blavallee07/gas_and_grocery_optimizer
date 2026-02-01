const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://pyhzvkupatgwpnaksyrr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5aHp2a3VwYXRnd3BuYWtzeXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4ODYyMjYsImV4cCI6MjA4NTQ2MjIyNn0.gjtBteE1l0Qy1fJajuLIgXaSh_g20byb608ABZ9a-jU';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };
