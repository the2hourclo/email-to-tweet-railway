require('dotenv').config();

async function listSkills() {
  console.log('🔍 Listing skills using correct API endpoint...');

  try {
    const response = await fetch('https://api.anthropic.com/v1/skills', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || 'dummy-key',
        'anthropic-beta': 'skills-2025-10-02',
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    console.log('✅ Skills API Response:');
    console.log(JSON.stringify(data, null, 2));

    // Look for content-to-tweets skill
    if (data.data && Array.isArray(data.data)) {
      const contentToTweetsSkill = data.data.find(skill =>
        skill.name === 'content-to-tweets' ||
        skill.name?.includes('content-to-tweets')
      );

      if (contentToTweetsSkill) {
        console.log('\n🎯 Found content-to-tweets skill:');
        console.log(`Skill ID: ${contentToTweetsSkill.id}`);
        console.log(`Name: ${contentToTweetsSkill.name}`);
        console.log(`Type: ${contentToTweetsSkill.type}`);
        console.log(`Source: ${contentToTweetsSkill.source}`);
      } else {
        console.log('\n⚠️ content-to-tweets skill not found');
        console.log('Available skills:');
        data.data.forEach(skill => {
          console.log(`- ${skill.name} (${skill.id})`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Error listing skills:', error.message);
  }
}

listSkills();
