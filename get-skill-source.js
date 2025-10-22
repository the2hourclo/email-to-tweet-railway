require('dotenv').config();

async function getSkillSource() {
  const skillId = process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW';

  console.log(`🔍 Attempting to fetch skill source files for: ${skillId}\n`);

  const endpoints = [
    `/v1/skills/${skillId}/source`,
    `/v1/skills/${skillId}/files`,
    `/v1/skills/${skillId}/versions/latest`,
    `/v1/skills/${skillId}/versions/latest/source`,
    `/v1/skills/${skillId}/versions/latest/files`,
    `/v1/skills/${skillId}/skill.md`,
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`📡 Trying: https://api.anthropic.com${endpoint}`);

      const response = await fetch(`https://api.anthropic.com${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-beta': 'skills-2025-10-02',
          'anthropic-version': '2023-06-01'
        }
      });

      console.log(`   Status: ${response.status}`);

      if (response.ok) {
        const contentType = response.headers.get('content-type');

        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          console.log('   ✅ SUCCESS! JSON Response:');
          console.log('   ' + '='.repeat(76));
          console.log(JSON.stringify(data, null, 2).split('\n').map(line => '   ' + line).join('\n'));
          console.log('   ' + '='.repeat(76));
        } else {
          const text = await response.text();
          console.log('   ✅ SUCCESS! Text Response:');
          console.log('   ' + '-'.repeat(76));
          console.log(text.split('\n').map(line => '   ' + line).join('\n'));
          console.log('   ' + '-'.repeat(76));
        }
        console.log('\n');
      } else {
        const errorText = await response.text();
        console.log(`   ❌ Error: ${errorText.substring(0, 100)}...\n`);
      }
    } catch (error) {
      console.log(`   ❌ Exception: ${error.message}\n`);
    }
  }

  console.log('\n💡 CONCLUSION:');
  console.log('If none of the endpoints returned the SKILL.md content, you\'ll need to:');
  console.log('1. Go to https://console.anthropic.com/skills');
  console.log('2. Open your content-to-tweets skill');
  console.log('3. Copy the SKILL.md file content');
  console.log('4. Share it so we can integrate it into the code');
}

getSkillSource();
