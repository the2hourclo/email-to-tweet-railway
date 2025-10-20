const express = require('express');
const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk'); 

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware for parsing JSON bodies
app.use(express.json());

// Initialize clients (will use environment variables)
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthantic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Environment Validation ---

function validateEnvironment() {
  const required = [
    'NOTION_TOKEN',
    'ANTHROPIC_API_KEY',
    'EMAILS_DATABASE_ID',
    'SHORTFORM_DATABASE_ID'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    return false;
  }
  
  console.log('✅ All required environment variables found');
  return true;
}

// --- Endpoints ---

// Health check endpoint
app.get('/', (req, res) => {
  console.log('🏥 Health check requested');
  
  if (!validateEnvironment()) {
    return res.status(500).json({ 
      error: 'Missing environment variables',
      status: 'unhealthy'
    });
  }

  res.json({ 
    message: 'Railway Email-to-Tweet Automation Server',
    status: 'healthy',
    version: '10.3 - Final ID Consistency Fix', // Version update
    endpoints: {
      health: '/',
      webhook: '/webhook'
    },
    config: {
        notionToken: process.env.NOTION_TOKEN ? 'Set' : 'Missing',
        anthropicKey: process.env.ANTHROPIC_API_KEY ? 'Set' : 'Missing',
        emailDbId: process.env.EMAILS_DATABASE_ID ? 'Set' : 'Missing',
        shortFormDbId: process.env.SHORTFORM_DATABASE_ID ? 'Set' : 'Missing',
        promptPage: process.env.PROMPT_PAGE_ID || 'Default Prompt',
    },
    timestamp: new Date().toISOString()
  });
});

// Webhook endpoint for Notion database button
app.post('/webhook', async (req, res) => {
  try {
    console.log('\n🔥 === NOTION BUTTON WEBHOOK RECEIVED ===');
    console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
    // Log keys for verification
    console.log('🔍 Top-level Body Keys:', Object.keys(req.body)); 

    let pageId = null;

    // 🏆 PRIMARY CHECK: The confirmed location for Page ID in Database Button Webhooks
    if (req.body.data && req.body.data.id) {
        // Notion database page IDs are nested under data.id
        pageId = req.body.data.id;
        console.log(`✅ Page ID found in req.body.data.id: ${pageId}`);
    } 
    // FALLBACKS (Kept for maximum compatibility, though we identified the primary location)
    else if (req.body.page_id) {
      pageId = req.body.page_id;
      console.log(`📄 Page ID from page_id field (Fallback 1): ${pageId}`);
    } else if (req.body.id) {
      pageId = req.body.id;
      console.log(`📄 Page ID from id field (Fallback 2): ${pageId}`);
    } else if (req.body.notion_page_id) {
      pageId = req.body.notion_page_id;
      console.log(`📄 Page ID from notion_page_id field (Fallback 3): ${pageId}`);
    } else {
      // Deep search for a standard Notion ID format
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string' && 
            (value.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/) || value.match(/^[a-f0-9]{32}$/))) {
          pageId = value;
          console.log(`📄 Page ID found via UUID search in ${key}: ${pageId}`);
          break;
        }
      }
    }


    if (!pageId) {
      console.log('❌ No page ID found in webhook payload');
      return res.status(400).json({ 
        error: 'No page ID found in webhook payload. Automation requires the triggering Page ID.',
        received_keys: Object.keys(req.body)
      });
    }

    // Acknowledge webhook immediately (crucial to prevent Notion timeout)
    res.status(200).json({ 
      message: 'Webhook received and processing started',
      page_id: pageId,
      timestamp: new Date().toISOString()
    });

    // Process the automation asynchronously so the response can be sent instantly
    processEmailAutomation(pageId)
      .then(result => {
        console.log('✅ Automation completed successfully:', result);
      })
      .catch(error => {
        console.error('❌ Automation failed:', error);
      });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});


// --- Core Automation Functions ---

// Main automation processing function
async function processEmailAutomation(pageId) {
  try {
    console.log(`\n🚀 === STARTING AUTOMATION ===`);
    console.log(`📄 Target Page ID: ${pageId}`);

    // Step 1: Verify this page is in the E-mails database and retrieve properties
    console.log('🔍 Step 1: Retrieving and verifying source page...');
    
    let pageInfo;
    try {
        pageInfo = await notion.pages.retrieve({ page_id: pageId });
    } catch (e) {
        if (e.code === 'object_not_found') {
             // We now specifically catch the error you were seeing and give a clearer message
             throw new Error(`Notion Access Error: Could not find page ID ${pageId}. This usually means the page or its PARENT DATABASE is not shared with your integration.`);
        }
        throw e; // re-throw other Notion errors
    }
    
    // The replace(/-/g, '') is necessary for comparison flexibility
    const expectedDbId = process.env.EMAILS_DATABASE_ID.replace(/-/g, '').toLowerCase(); // Added toLowerCase()
    
    // DEBUGGING LOG: Prints the IDs being compared
    console.log(`\nDEBUG: Comparing DB IDs:`);
    console.log(`DEBUG: Expected (ENV): ${expectedDbId}`);
    console.log(`DEBUG: Received (Page Parent): ${pageInfo.parent.database_id.replace(/-/g, '').toLowerCase()}`); // Added toLowerCase()
    console.log(`DEBUG: The two IDs must match exactly (ignoring hyphens and case).\n`);
    
    // Check if page is in the correct database (case-insensitive check)
    if (!pageInfo.parent || 
        pageInfo.parent.type !== 'database_id' || 
        pageInfo.parent.database_id.replace(/-/g, '').toLowerCase() !== expectedDbId) {
      console.log('ℹ️ Page is not in E-mails database - skipping automation');
      return { status: 'skipped', reason: 'Page not in E-mails database' };
    }

    console.log('✅ Page confirmed to be in E-mails database');

    // Step 2: Check if this email has already been processed (optional skip)
    console.log('🔍 Step 2: Checking if email already processed...');
    
    const existingQuery = await notion.databases.query({
      database_id: process.env.SHORTFORM_DATABASE_ID,
      filter: {
        property: 'E-mails', // Confirmed relation name
        relation: {
          contains: pageId
        }
      }
    });

    if (existingQuery.results.length > 0) {
      console.log(`ℹ️ Email already processed - found ${existingQuery.results.length} existing entries`);
      return { status: 'skipped', reason: 'Email already processed' };
    }

    console.log('✅ Email not yet processed - continuing automation');

    // Step 3: Get email content
    console.log('📖 Step 3: Extracting email content...');
    const emailContent = await getEmailContent(pageId);
    console.log(`✅ Extracted ${emailContent.length} characters of content`);

    // Step 4: Get processing prompt
    console.log('📝 Step 4: Getting processing prompt...');
    const prompt = await getPromptFromNotion();
    console.log('✅ Prompt retrieved');

    // Step 5: Generate tweets using Claude
    console.log('🤖 Step 5: Generating content with Claude...');
    const tweetsData = await generateTweets(emailContent, prompt);
    console.log(`✅ Generated ${tweetsData.threads?.length || 0} thread concepts`);

    // Step 6: Create pages in Short Form database
    console.log('📝 Step 6: Creating Short Form pages...');
    const createdPages = await createShortFormPages(tweetsData, pageId);
    console.log(`✅ Created ${createdPages.length} pages in Short Form database`);

    console.log('🎉 === AUTOMATION COMPLETED ===');
    return {
      status: 'success',
      email_page_id: pageId,
      content_length: emailContent.length,
      threads_generated: tweetsData.threads?.length || 0,
      pages_created: createdPages.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Automation processing error:', error);
    throw new Error(`Automation failed: ${error.message}`);
  }
}

// Get email content from Notion page
async function getEmailContent(pageId) {
  try {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100
    });

    let content = '';
    
    for (const block of response.results) {
      // Logic for extracting various block types (paragraph, headings, lists, etc.)
      if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        const text = block.paragraph.rich_text.map(text => text.plain_text).join('');
        content += text + '\n\n';
      } 
      else if (block.type.startsWith('heading') && block[block.type].rich_text.length > 0) {
        const text = block[block.type].rich_text.map(text => text.plain_text).join('');
        content += (block.type === 'heading_1' ? '# ' : block.type === 'heading_2' ? '## ' : '### ') + text + '\n\n';
      } 
      else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text.length > 0) {
        const text = block.bulleted_list_item.rich_text.map(text => text.plain_text).join('');
        content += '• ' + text + '\n';
      }
      else if (block.type === 'numbered_list_item' && block.numbered_list_item.rich_text.length > 0) {
        const text = block.numbered_list_item.rich_text.map(text => text.plain_text).join('');
        content += '1. ' + text + '\n';
      }
      // Add other relevant block types if necessary
    }

    if (!content.trim()) {
      throw new Error('No readable content blocks found in the email page. The Notion page may be empty or use unsupported block types.');
    }

    return content.trim();
  } catch (error) {
    throw new Error(`Failed to fetch email content: ${error.message}`);
  }
}

// Get prompt from Notion page (using fallback if PROMPT_PAGE_ID not set)
async function getPromptFromNotion() {
  try {
    if (!process.env.PROMPT_PAGE_ID) {
      return `You are an expert content creator who specializes in converting newsletters and emails into engaging Twitter threads.

Your task is to analyze the provided email content and create 5 different Twitter thread concepts.

For each thread concept, provide:
1. A compelling hook tweet (thread starter)
2. 3-5 follow-up tweets that develop the idea
3. A clear call-to-action

Guidelines:
- Keep each tweet under 280 characters
- Use engaging, conversational tone
- Focus on actionable insights
- Include relevant hashtags
- Your entire response MUST be a single, valid JSON object starting with {"threads": [...]}. Do NOT include any explanations or commentary outside of the JSON block.

Format your response as valid JSON:
{
  "threads": [
    {
      "title": "Thread concept title",
      "tweets": ["Tweet 1", "Tweet 2", "Tweet 3", "Tweet 4"]
    }
  ]
}`;
    }

    const response = await notion.blocks.children.list({
      block_id: process.env.PROMPT_PAGE_ID
    });

    let prompt = '';
    for (const block of response.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        prompt += block.paragraph.rich_text.map(text => text.plain_text).join('') + '\n';
      }
    }

    return prompt.trim() || 'Create engaging Twitter threads from the email content provided.';
  } catch (error) {
    console.error('❌ Error fetching prompt:', error);
    return 'Create engaging Twitter threads from the email content provided.';
  }
}

// Generate tweets using Claude
async function generateTweets(emailContent, prompt) {
  try {
    const fullPrompt = `${prompt}

EMAIL CONTENT:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

Generate 5 Twitter thread concepts in JSON format. Your entire response MUST be the single, valid JSON object starting with {"threads": [...]}.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4', // <<-- USING CLAUDE SONNET 4
      max_tokens: 4000,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    
    // Robustly search for the JSON block in the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    } else {
      // This is the fallback for bad Claude formatting
      throw new Error('Claude response did not contain valid JSON in the expected format.');
    }
  } catch (error) {
    // Check if the error is a rate limit or another transient issue before throwing
    if (error.status && error.status !== 404) {
      console.error(`Claude API Error: Status ${error.status}. Check API key and billing.`);
    }
    throw new Error(`Claude generation failed: ${error.message}`);
  }
}

// Create pages in Short Form database
async function createShortFormPages(tweetsData, emailPageId) {
  try {
    const results = [];

    for (let i = 0; i < tweetsData.threads.length; i++) {
      const thread = tweetsData.threads[i];
      // Join tweets with triple dash separator for visual clarity in Notion
      const content = thread.tweets.join('\n\n---\n\n'); 
      
      const response = await notion.pages.create({
        parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
        properties: {
          'Name': {
            title: [{ text: { content: thread.title } }]
          },
          'E-mails': { // Confirmed Relation property name
            relation: [{ id: emailPageId }]
          }
        },
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: content } }]
          }
        }]
      });

      results.push({ id: response.id, title: thread.title });
    }

    return results;
  } catch (error) {
    throw new Error(`Failed to create pages in Notion: ${error.message}`);
  }
}

// Validate environment on startup
if (!validateEnvironment()) {
  console.error('❌ Server starting with missing environment variables. Functionality will be impaired.');
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Email-to-Tweet server running on port ${PORT}`);
  console.log(`🔧 Version: 10.3 - Final ID Consistency Fix`);
});


