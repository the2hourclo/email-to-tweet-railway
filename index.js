const express = require('express');
const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk'); 

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware for parsing JSON bodies
app.use(express.json());

// Initialize clients (will use environment variables)
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    version: '8.0 - Webhook Fix Implemented',
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
    // Log keys for verification, but skip full body to avoid large output
    console.log('🔍 Top-level Body Keys:', Object.keys(req.body)); 

    let pageId = null;

    // 🏆 PRIMARY CHECK: The confirmed location for Page ID in Database Button Webhooks
    if (req.body.data && req.body.data.id) {
        // Notion database page IDs are nested under data.id
        pageId = req.body.data.id;
        console.log(`✅ Page ID found in req.body.data.id: ${pageId}`);
    } 
    // FALLBACKS (for compatibility with other webhook types if testing payload changed)
    else if (req.body.page_id) {
      pageId = req.body.page_id;
      console.log(`📄 Page ID from page_id field (Fallback 1): ${pageId}`);
    } else if (req.body.id) {
      pageId = req.body.id;
      console.log(`📄 Page ID from id field (Fallback 2): ${pageId}`);
    } else {
      // Deep search for a standard Notion ID format (UUID or 32-char hex)
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


// --- Core Automation Functions (Restored) ---

// Main automation processing function
async function processEmailAutomation(pageId) {
  try {
    console.log(`\n🚀 === STARTING AUTOMATION ===`);
    console.log(`📄 Target Page ID: ${pageId}`);

    // Step 1: Verify this page is in the E-mails database
    console.log('🔍 Step 1: Verifying page is in E-mails database...');
    // The replace(/-/g, '') is necessary because the API often returns database IDs 
    // with hyphens, but environment variables might be set without them.
    const expectedDbId = process.env.EMAILS_DATABASE_ID.replace(/-/g, '');
    const pageInfo = await notion.pages.retrieve({ page_id: pageId });
    
    // Check if page is in the correct database
    if (!pageInfo.parent || 
        pageInfo.parent.type !== 'database_id' || 
        pageInfo.parent.database_id.replace(/-/g, '') !== expectedDbId) {
      console.log('ℹ️ Page is not in E-mails database - skipping automation');
      return { status: 'skipped', reason: 'Page not in E-mails database' };
    }

    console.log('✅ Page confirmed to be in E-mails database');

    // Step 2: Check if this email has already been processed (optional skip)
    console.log('🔍 Step 2: Checking if email already processed...');
    
    const existingQuery = await notion.databases.query({
      database_id: process.env.SHORTFORM_DATABASE_ID,
      filter: {
        property: 'E-mails', // Assuming the relation property name is 'E-mails'
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
    // You can optionally update the Notion page status here to indicate failure
    throw new Error(`Automation failed: ${error.message}`);
  }
}

// Get email content from Notion page (restored)
async function getEmailContent(pageId) {
  try {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100
    });

    let content = '';
    
    for (const block of response.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        const text = block.paragraph.rich_text.map(text => text.plain_text).join('');
        content += text + '\n\n';
      } 
      else if (block.type === 'heading_1' && block.heading_1.rich_text.length > 0) {
        const text = block.heading_1.rich_text.map(text => text.plain_text).join('');
        content += '# ' + text + '\n\n';
      } 
      else if (block.type === 'heading_2' && block.heading_2.rich_text.length > 0) {
        const text = block.heading_2.rich_text.map(text => text.plain_text).join('');
        content += '## ' + text + '\n\n';
      } 
      else if (block.type === 'heading_3' && block.heading_3.rich_text.length > 0) {
        const text = block.heading_3.rich_text.map(text => text.plain_text).join('');
        content += '### ' + text + '\n\n';
      }
      else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text.length > 0) {
        const text = block.bulleted_list_item.rich_text.map(text => text.plain_text).join('');
        content += '• ' + text + '\n';
      }
      else if (block.type === 'numbered_list_item' && block.numbered_list_item.rich_text.length > 0) {
        const text = block.numbered_list_item.rich_text.map(text => text.plain_text).join('');
        content += '1. ' + text + '\n';
      }
      else if (block.type === 'quote' && block.quote.rich_text.length > 0) {
        const text = block.quote.rich_text.map(text => text.plain_text).join('');
        content += '> ' + text + '\n\n';
      }
      else if (block.type === 'code' && block.code.rich_text.length > 0) {
        const text = block.code.rich_text.map(text => text.plain_text).join('');
        content += '```\n' + text + '\n```\n\n';
      }
    }

    if (!content.trim()) {
      throw new Error('No content blocks found in the email page.');
    }

    return content.trim();
  } catch (error) {
    console.error('❌ Error fetching email content:', error);
    throw new Error(`Failed to fetch email content: ${error.message}`);
  }
}

// Get prompt from Notion page (restored)
async function getPromptFromNotion() {
  try {
    if (!process.env.PROMPT_PAGE_ID) {
      console.log('📝 Using fallback prompt (no PROMPT_PAGE_ID set)');
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
- Return results in JSON format with threads array

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

    console.log(`📝 Fetching prompt from Notion page: ${process.env.PROMPT_PAGE_ID}`);

    const response = await notion.blocks.children.list({
      block_id: process.env.PROMPT_PAGE_ID,
      page_size: 100
    });

    let prompt = '';
    for (const block of response.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        prompt += block.paragraph.rich_text.map(text => text.plain_text).join('') + '\n';
      }
    }

    const finalPrompt = prompt.trim() || 'Create engaging Twitter threads from the email content provided.';
    console.log(`✅ Prompt fetched: ${finalPrompt.substring(0, 100)}...`);
    return finalPrompt;
  } catch (error) {
    console.error('❌ Error fetching prompt:', error);
    console.log('📝 Using fallback prompt due to error');
    return 'Create engaging Twitter threads from the email content provided.';
  }
}

// Generate tweets using Claude (restored)
async function generateTweets(emailContent, prompt) {
  try {
    console.log('🤖 Generating content with Claude...');
    
    const fullPrompt = `${prompt}

EMAIL CONTENT:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

Generate 5 Twitter thread concepts in JSON format. Each thread should be engaging and actionable. Ensure the output is a single, valid JSON object starting with {"threads": [...]}.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    console.log(`🤖 Claude response length: ${content.length} characters`);
    
    try {
      // Robustly search for the JSON block in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`✅ Successfully parsed ${parsed.threads?.length || 0} thread concepts`);
        return parsed;
      } else {
        throw new Error('No JSON found in Claude response');
      }
    } catch (parseError) {
      console.log('⚠️ JSON parsing failed, using simple fallback structure.');
      console.log('Parse error:', parseError.message);
      // Fallback if JSON parsing fails
      return {
        threads: [{
          title: "Generated Content Fallback",
          tweets: [
            content.substring(0, 280),
            content.substring(280, 560) || "Check out our newsletter for more insights!",
            process.env.NEWSLETTER_LINK || "Subscribe for more content like this!"
          ]
        }]
      };
    }
  } catch (error) {
    console.error('❌ Error generating content with Claude:', error);
    throw new Error(`Failed to generate content: ${error.message}`);
  }
}

// Create pages in Short Form database (restored)
async function createShortFormPages(tweetsData, emailPageId) {
  try {
    console.log(`📝 Creating ${tweetsData.threads.length} short form pages...`);
    const results = [];

    for (let i = 0; i < tweetsData.threads.length; i++) {
      const thread = tweetsData.threads[i];
      // Join tweets with triple dash separator for visual clarity in Notion
      const content = thread.tweets.join('\n\n---\n\n'); 
      
      console.log(`📄 Creating page ${i + 1}: ${thread.title}`);
      
      const response = await notion.pages.create({
        parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
        properties: {
          'Name': {
            title: [{ text: { content: thread.title } }]
          },
          'E-mails': { // Relation property name assumed to be 'E-mails'
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

      results.push({
        id: response.id,
        title: thread.title
      });
      
      console.log(`✅ Created: ${thread.title}`);
    }

    console.log(`🎉 Successfully created ${results.length} pages in Short Form database`);
    return results;
  } catch (error) {
    console.error('❌ Error creating short form pages:', error);
    throw new Error(`Failed to create pages: ${error.message}`);
  }
}

// Validate environment on startup
if (!validateEnvironment()) {
  console.error('❌ Server cannot start due to missing environment variables');
  // Do not exit in a cloud environment, let it try to run for logs
  // process.exit(1); 
}

// Start server (restored)
app.listen(PORT, () => {
  console.log(`🚀 Email-to-Tweet server running on port ${PORT}`);
  console.log(`🔧 Version: 8.0 - Webhook Fix Implemented`);
  console.log(`💡 Trigger: Click "Generate Content" button in E-mails database`);
});


