require('dotenv').config();

async function testSkill() {
  const skillId = process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW';

  console.log('🧪 Testing content-to-tweets skill\n');
  console.log(`📦 Skill ID: ${skillId}\n`);

  // Sample email content for testing
  const sampleContent = `
  Building Better Habits: The 2-Minute Rule

  Most people think they need massive willpower to build new habits. But what if the secret is starting smaller than you think?

  The 2-Minute Rule states: "When you start a new habit, it should take less than two minutes to do."

  Want to read more? Start with one page.
  Want to exercise? Do one push-up.
  Want to meditate? Breathe for two minutes.

  The key insight: A habit must be established before it can be improved. You can't optimize what doesn't exist yet.

  Master the art of showing up. The rest will follow.
  `;

  try {
    console.log('📨 Sample Input:');
    console.log('-'.repeat(80));
    console.log(sampleContent);
    console.log('-'.repeat(80));

    console.log('\n🚀 Calling Skills API...\n');

    // Use Skills API with code execution container (CORRECT APPROACH)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-beta': 'code-execution-2025-08-25,skills-2025-10-02',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 4000,
        tools: [{
          type: 'code_execution_20250825',
          name: 'code_execution'
        }],
        container: {
          skills: [{
            type: 'custom',
            skill_id: skillId,
            version: 'latest'
          }]
        },
        messages: [{
          role: 'user',
          content: sampleContent
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Skills API HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    console.log('✅ Skills API Response:\n');
    console.log('FULL RESPONSE:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(data, null, 2));
    console.log('='.repeat(80));

    if (data.content && data.content[0]) {
      console.log('\n📤 GENERATED OUTPUT:');
      console.log('-'.repeat(80));
      console.log(data.content[0].text);
      console.log('-'.repeat(80));
    }

    console.log('\n📊 Response Stats:');
    console.log(`- Stop Reason: ${data.stop_reason}`);
    console.log(`- Input Tokens: ${data.usage?.input_tokens || 'N/A'}`);
    console.log(`- Output Tokens: ${data.usage?.output_tokens || 'N/A'}`);

  } catch (error) {
    console.error('❌ Error testing skill:', error.message);
  }
}

testSkill();
