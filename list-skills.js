const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function listSkills() {
  try {
    const response = await fetch('https://api.anthropic.com/v1/skills', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-beta': 'skills-2025-10-02'
      }
    });

    const data = await response.json();
    console.log('Available Skills:');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error listing skills:', error);
  }
}

listSkills();
