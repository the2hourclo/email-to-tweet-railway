require('dotenv').config();

async function getSkillVersion() {
  const skillId = process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW';

  console.log(`🔍 Fetching skill version details for: ${skillId}\n`);

  try {
    // Step 1: Get basic skill info to find the latest version
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
    console.log('✅ Skill info retrieved\n');

    const latestVersion = skillData.latest_version;
    console.log(`📋 Skill ID: ${skillData.id}`);
    console.log(`📋 Display Title: ${skillData.display_title}`);
    console.log(`📋 Latest Version: ${latestVersion}\n`);

    // Step 2: Get the specific version details using the documented endpoint
    console.log(`📦 Step 2: Getting version details for ${latestVersion}...`);

    const versionResponse = await fetch(`https://api.anthropic.com/v1/skills/${skillId}/versions/${latestVersion}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-beta': 'skills-2025-10-02',
        'anthropic-version': '2023-06-01'
      }
    });

    if (!versionResponse.ok) {
      const errorText = await versionResponse.text();
      throw new Error(`HTTP ${versionResponse.status}: ${errorText}`);
    }

    const versionData = await versionResponse.json();
    console.log('✅ Version details retrieved\n');

    console.log('FULL VERSION DETAILS:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(versionData, null, 2));
    console.log('='.repeat(80));

    // Extract and display key information
    console.log('\n📊 KEY INFORMATION:');
    console.log('-'.repeat(80));
    console.log(`Type: ${versionData.type}`);
    console.log(`Skill ID: ${versionData.skill_id}`);
    console.log(`Version ID: ${versionData.id}`);
    console.log(`Version: ${versionData.version}`);
    console.log(`Name: ${versionData.name}`);
    console.log(`Directory: ${versionData.directory}`);
    console.log(`Created: ${versionData.created_at}`);
    console.log(`\nDescription:\n${versionData.description}`);
    console.log('-'.repeat(80));

    // Check for any additional fields that might contain the prompt/instructions
    const unexpectedFields = Object.keys(versionData).filter(key =>
      !['type', 'skill_id', 'id', 'version', 'name', 'directory', 'description', 'created_at'].includes(key)
    );

    if (unexpectedFields.length > 0) {
      console.log('\n🔍 ADDITIONAL FIELDS FOUND:');
      console.log('-'.repeat(80));
      unexpectedFields.forEach(key => {
        console.log(`${key}:`);
        console.log(JSON.stringify(versionData[key], null, 2));
        console.log('');
      });
      console.log('-'.repeat(80));
    }

    return versionData;

  } catch (error) {
    console.error('\n❌ Error fetching skill version:', error.message);
  }
}

getSkillVersion();
