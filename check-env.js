require('dotenv').config();

console.log('🔍 Checking environment variables...');
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? `✅ Set (${process.env.ANTHROPIC_API_KEY.substring(0, 8)}...)` : '❌ NOT SET');
console.log('NOTION_TOKEN:', process.env.NOTION_TOKEN ? `✅ Set (${process.env.NOTION_TOKEN.substring(0, 8)}...)` : '❌ NOT SET');

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('\n❌ ANTHROPIC_API_KEY is missing!');
  console.log('You need to:');
  console.log('1. Create a .env file in the project root');
  console.log('2. Add: ANTHROPIC_API_KEY=your_new_key_here');
  console.log('3. Or set it in your Railway environment variables');
} else {
  console.log('\n✅ API key is configured!');
}
