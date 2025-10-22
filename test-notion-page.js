require('dotenv').config();
const { Client } = require('@notionhq/client');

async function testNotionPage() {
  // Extract page ID from URL
  const notionUrl = 'https://the2hourman.notion.site/Why-Free-Time-to-Build-just-became-your-most-valuable-business-asset-Cleaned-up-Version-2914289667b880898f31ed2b766ffe02';

  // Extract the 32-character page ID from the URL
  const pageIdMatch = notionUrl.match(/([a-f0-9]{32})/);
  if (!pageIdMatch) {
    console.error('❌ Could not extract page ID from URL');
    return;
  }

  const pageId = pageIdMatch[1];
  console.log(`📄 Page ID: ${pageId}\n`);

  // Format with dashes for Notion API
  const formattedPageId = `${pageId.slice(0, 8)}-${pageId.slice(8, 12)}-${pageId.slice(12, 16)}-${pageId.slice(16, 20)}-${pageId.slice(20)}`;
  console.log(`📄 Formatted Page ID: ${formattedPageId}\n`);

  // Check if we have Notion token
  if (!process.env.NOTION_TOKEN || process.env.NOTION_TOKEN === 'your_notion_token_here') {
    console.log('⚠️  NOTION_TOKEN not configured. Skipping Notion API fetch.');
    console.log('📝 Please either:');
    console.log('   1. Add NOTION_TOKEN to .env file');
    console.log('   2. Or manually copy-paste the page content below for testing\n');
    return;
  }

  try {
    console.log('🔍 Fetching content from Notion...\n');

    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    // Get page content
    const blocks = await notion.blocks.children.list({
      block_id: formattedPageId,
      page_size: 100
    });

    let content = '';

    for (const block of blocks.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text) {
        const text = block.paragraph.rich_text.map(rt => rt.plain_text).join('');
        content += text + '\n';
      } else if (block.type === 'heading_1' && block.heading_1.rich_text) {
        const text = block.heading_1.rich_text.map(rt => rt.plain_text).join('');
        content += text + '\n';
      } else if (block.type === 'heading_2' && block.heading_2.rich_text) {
        const text = block.heading_2.rich_text.map(rt => rt.plain_text).join('');
        content += text + '\n';
      } else if (block.type === 'heading_3' && block.heading_3.rich_text) {
        const text = block.heading_3.rich_text.map(rt => rt.plain_text).join('');
        content += text + '\n';
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text) {
        const text = block.bulleted_list_item.rich_text.map(rt => rt.plain_text).join('');
        content += '• ' + text + '\n';
      } else if (block.type === 'numbered_list_item' && block.numbered_list_item.rich_text) {
        const text = block.numbered_list_item.rich_text.map(rt => rt.plain_text).join('');
        content += text + '\n';
      }
    }

    console.log('✅ Content extracted from Notion\n');
    console.log('📝 CONTENT:');
    console.log('='.repeat(80));
    console.log(content.substring(0, 1000) + (content.length > 1000 ? '...\n\n[Content truncated for display]' : ''));
    console.log('='.repeat(80));
    console.log(`\nTotal length: ${content.length} characters\n`);

    // Now test with the skill
    console.log('🚀 Testing with content-to-tweets skill...\n');

    const skillId = process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW';
    const newsletterLink = process.env.NEWSLETTER_LINK || 'https://your-newsletter-link.com';

    const userPrompt = `${content}

Newsletter Link: ${newsletterLink}`;

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
          content: userPrompt
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Skills API HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    console.log('✅ Skill execution completed\n');
    console.log('📊 Stats:');
    console.log(`   Stop Reason: ${data.stop_reason}`);
    console.log(`   Input Tokens: ${data.usage?.input_tokens || 'N/A'}`);
    console.log(`   Output Tokens: ${data.usage?.output_tokens || 'N/A'}\n`);

    // Extract text output
    let resultText = '';
    for (const block of data.content) {
      if (block.type === 'text') {
        resultText += block.text;
      }
    }

    console.log('📤 SKILL OUTPUT:');
    console.log('='.repeat(80));
    console.log(resultText);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testNotionPage();
