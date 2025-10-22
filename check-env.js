require('dotenv').config();

console.log('🔍 Checking environment variables...');
console.log('\n📋 API Keys:');
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? `✅ Set (${process.env.ANTHROPIC_API_KEY.substring(0, 8)}...)` : '❌ NOT SET');
console.log('NOTION_TOKEN:', process.env.NOTION_TOKEN ? `✅ Set (${process.env.NOTION_TOKEN.substring(0, 8)}...)` : '❌ NOT SET');

console.log('\n📦 Skills API Configuration:');
console.log('USE_SKILLS_API:', process.env.USE_SKILLS_API ? `✅ ${process.env.USE_SKILLS_API}` : '❌ NOT SET (default: false)');
console.log('CONTENT_TO_TWEETS_SKILL_ID:', process.env.CONTENT_TO_TWEETS_SKILL_ID ? `✅ ${process.env.CONTENT_TO_TWEETS_SKILL_ID}` : '❌ NOT SET (using default)');

console.log('\n⚙️ Configuration:');
console.log('CLAUDE_MODEL_NAME:', process.env.CLAUDE_MODEL_NAME ? `✅ ${process.env.CLAUDE_MODEL_NAME}` : '❌ NOT SET');
console.log('NEWSLETTER_LINK:', process.env.NEWSLETTER_LINK ? `✅ Set` : '❌ NOT SET');

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('\n❌ ANTHROPIC_API_KEY is missing!');
  console.log('You need to:');
  console.log('1. Create a .env file in the project root');
  console.log('2. Add: ANTHROPIC_API_KEY=your_new_key_here');
  console.log('3. Or set it in your Railway environment variables');
} else {
  console.log('\n✅ API key is configured!');

  if (process.env.USE_SKILLS_API === 'true') {
    console.log('✅ Skills API is ENABLED');
    console.log(`📦 Using skill: ${process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW (default)'}`);
  } else {
    console.log('ℹ️  Skills API is DISABLED (using direct Claude API)');
  }
}
