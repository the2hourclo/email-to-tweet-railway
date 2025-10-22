require('dotenv').config();

async function getSkillDetails() {
  const skillId = process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW';

  console.log(`🔍 Fetching details for skill: ${skillId}\n`);

  try {
    // First, get basic skill info
    console.log('📦 Step 1: Getting basic skill info...');
    const skillResponse = await fetch(`https://api.anthropic.com/v1/skills/${skillId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-beta': 'skills-2025-10-02',
        'anthropic-version': '2023-06-01'
      }
    });

    if (!skillResponse.ok) {
      throw new Error(`HTTP ${skillResponse.status}: ${await skillResponse.text()}`);
    }

    const skillData = await skillResponse.json();
    console.log('✅ Basic skill info retrieved\n');
    console.log('SKILL METADATA:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(skillData, null, 2));
    console.log('='.repeat(80));

    // Now try to get the skill version details (which should have the prompt)
    if (skillData.latest_version) {
      console.log(`\n📦 Step 2: Getting skill version ${skillData.latest_version}...`);

      const versionResponse = await fetch(`https://api.anthropic.com/v1/skills/${skillId}/versions/${skillData.latest_version}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-beta': 'skills-2025-10-02',
          'anthropic-version': '2023-06-01'
        }
      });

      if (versionResponse.ok) {
        const versionData = await versionResponse.json();
        console.log('✅ Version details retrieved\n');
        console.log('SKILL VERSION DETAILS:');
        console.log('='.repeat(80));
        console.log(JSON.stringify(versionData, null, 2));
        console.log('='.repeat(80));

        // Extract important fields
        if (versionData.skill_md) {
          console.log('\n📝 SKILL.MD CONTENT:');
          console.log('-'.repeat(80));
          console.log(versionData.skill_md);
          console.log('-'.repeat(80));
        }

        if (versionData.prompt || versionData.system_prompt) {
          console.log('\n📝 SKILL PROMPT:');
          console.log('-'.repeat(80));
          console.log(versionData.prompt || versionData.system_prompt);
          console.log('-'.repeat(80));
        }
      } else {
        console.log(`⚠️  Could not fetch version details: ${versionResponse.status}`);
      }
    }

  } catch (error) {
    console.error('❌ Error fetching skill details:', error.message);
    console.error('\n💡 TIP: The skill prompt/instructions might only be visible in the Anthropic Console.');
    console.error('    Visit: https://console.anthropic.com/skills to view your skill details.');
  }
}

getSkillDetails();
