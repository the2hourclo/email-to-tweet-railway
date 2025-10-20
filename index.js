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
    'SHORTFORM_DATABASE_ID',
    'CLAUDE_MODEL_NAME' 
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
    version: '11.0 - 2HourMan Tweet Prompt Integration', // Version update
    endpoints: {
      health: '/',
      webhook: '/webhook'
    },
    config: {
        notionToken: process.env.NOTION_TOKEN ? 'Set' : 'Missing',
        anthropicKey: process.env.ANTHROPIC_API_KEY ? 'Set' : 'Missing',
        emailDbId: process.env.EMAILS_DATABASE_ID ? 'Set' : 'Missing',
        shortFormDbId: process.env.SHORTFORM_DATABASE_ID ? 'Set' : 'Missing',
        modelName: process.env.CLAUDE_MODEL_NAME ? process.env.CLAUDE_MODEL_NAME : 'Missing',
        promptPage: process.env.PROMPT_PAGE_ID || 'Default Prompt',
    },
    timestamp: new Date().toISOString()
  });
});

// Webhook endpoint for Notion database button
app.post('/webhook', async (req, res) => {
  try {
    console.log('\n🔥 === NOTION BUTTON WEBHOOK RECEIVED ===');
    console.log('🔍 Top-level Body Keys:', Object.keys(req.body)); 

    let pageId = null;

    // PRIMARY CHECK: The confirmed location for Page ID in Database Button Webhooks
    if (req.body.data && req.body.data.id) {
        pageId = req.body.data.id;
        console.log(`✅ Page ID found in req.body.data.id: ${pageId}`);
    } 
    // FALLBACKS (Retained for robustness)
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
             throw new Error(`Notion Access Error: Could not find page ID ${pageId}. This usually means the page or its PARENT DATABASE is not shared with your integration.`);
        }
        throw e;
    }
    
    const expectedDbId = process.env.EMAILS_DATABASE_ID.replace(/-/g, '').toLowerCase(); 
    const receivedDbId = pageInfo.parent.type === 'database_id' ? pageInfo.parent.database_id.replace(/-/g, '').toLowerCase() : 'Not a Database Page';
    
    console.log(`DEBUG: Expected DB ID: ${expectedDbId}`);
    console.log(`DEBUG: Received DB ID: ${receivedDbId}`);
    
    // Check if page is in the correct database
    if (!pageInfo.parent || 
        pageInfo.parent.type !== 'database_id' || 
        receivedDbId !== expectedDbId) {
      console.log('ℹ️ Page is not in E-mails database - skipping automation');
      return { status: 'skipped', reason: 'Page not in E-mails database' };
    }

    console.log('✅ Page confirmed to be in E-mails database');

    // Step 2: Check if this email has already been processed
    console.log('🔍 Step 2: Checking if email already processed...');
    
    const existingQuery = await notion.databases.query({
      database_id: process.env.SHORTFORM_DATABASE_ID,
      filter: {
        property: 'E-mails',
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

    // Step 4: Get processing prompt from Notion
    console.log('📝 Step 4: Getting 2HourMan tweet prompt from Notion...');
    const prompt = await getPromptFromNotion();
    console.log('✅ 2HourMan tweet prompt retrieved');

    // Step 5: Generate tweets using Claude with your prompt
    console.log('🤖 Step 5: Generating tweets with 2HourMan methodology...');
    const tweetsData = await generateTweetsWithPrompt(emailContent, prompt);
    console.log(`✅ Generated structured tweet analysis`);

    // Step 6: Create pages in Short Form database with proper formatting
    console.log('📝 Step 6: Creating Short Form pages with 2HourMan structure...');
    const createdPages = await createShortFormPages(tweetsData, pageId);
    console.log(`✅ Created ${createdPages.length} pages in Short Form database`); 

    console.log('🎉 === AUTOMATION COMPLETED ===');
    return {
      status: 'success',
      email_page_id: pageId,
      content_length: emailContent.length,
      tweets_generated: tweetsData.tweets?.length || 0,
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
    }

    if (!content.trim()) {
      throw new Error('No readable content blocks found in the email page.');
    }

    return content.trim();
  } catch (error) {
    throw new Error(`Failed to fetch email content: ${error.message}`);
  }
}

// FIXED: Get prompt from Notion page - properly extract all content
async function getPromptFromNotion() {
  try {
    console.log(`🔍 Reading prompt from Notion page ID: ${process.env.PROMPT_PAGE_ID}`);
    
    if (!process.env.PROMPT_PAGE_ID) {
      console.log('⚠️ No PROMPT_PAGE_ID set, using fallback prompt');
      return getDefaultPrompt();
    }

    const response = await notion.blocks.children.list({
      block_id: process.env.PROMPT_PAGE_ID,
      page_size: 100
    });

    console.log(`📄 Found ${response.results.length} blocks in prompt page`);

    let prompt = '';
    
    for (const block of response.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        const text = block.paragraph.rich_text.map(text => text.plain_text).join('');
        prompt += text + '\n\n';
      }
      else if (block.type.startsWith('heading') && block[block.type].rich_text.length > 0) {
        const text = block[block.type].rich_text.map(text => text.plain_text).join('');
        prompt += (block.type === 'heading_1' ? '# ' : block.type === 'heading_2' ? '## ' : '### ') + text + '\n\n';
      }
      else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text.length > 0) {
        const text = block.bulleted_list_item.rich_text.map(text => text.plain_text).join('');
        prompt += '• ' + text + '\n';
      }
      else if (block.type === 'numbered_list_item' && block.numbered_list_item.rich_text.length > 0) {
        const text = block.numbered_list_item.rich_text.map(text => text.plain_text).join('');
        prompt += '1. ' + text + '\n';
      }
      else if (block.type === 'code' && block.code.rich_text.length > 0) {
        const text = block.code.rich_text.map(text => text.plain_text).join('');
        prompt += '```\n' + text + '\n```\n\n';
      }
    }

    const finalPrompt = prompt.trim();
    
    if (!finalPrompt) {
      console.log('⚠️ Prompt page appears to be empty, using fallback');
      return getDefaultPrompt();
    }

    console.log(`✅ Successfully extracted ${finalPrompt.length} characters from prompt page`);
    console.log(`📝 Prompt preview: ${finalPrompt.substring(0, 200)}...`);
    
    return finalPrompt;

  } catch (error) {
    console.error('❌ Error fetching prompt from Notion:', error);
    console.log('🔄 Falling back to default prompt');
    return getDefaultPrompt();
  }
}

// Fallback prompt (simplified version of your methodology)
function getDefaultPrompt() {
  return `You are a content extraction specialist for the 2 Hour Man brand. Transform content into high-quality tweets following this methodology:

PHASE 1: Content Analysis
- Identify core message/theme
- Extract key insights and arguments
- Find specific examples/evidence
- Note frameworks/processes
- Capture metrics/numbers
- Identify unique perspectives

PHASE 2: Tweet Development
For EACH tweet, ensure:

SINGLE AHA MOMENT: One clear insight/realization that everything builds toward

WHAT-WHY-WHERE CYCLES (MANDATORY):
- WHAT: Define/explain the concept clearly (no jargon without plain language)
- WHY: Connect to audience pain/goals, show mechanism/psychology 
- WHERE: Give clear direction on what to focus on or do

CORE PRINCIPLES:
- No jargon without explaining in plain language
- Explain mechanisms, don't just name them
- Use actual concepts from source content
- Nothing should require visuals to understand
- No formulaic markers ("Result:", "Key takeaway:", etc.)

Create 3-5 tweets following this structure. For each tweet, provide:

TWEET #X: [Brief Description]

Main Content:
[Full tweet text]

Single Aha Moment:
[State the ONE core insight]

What-Why-Where Check:
✅ WHAT: [How concept is defined]
✅ WHY: [Mechanism/importance shown]  
✅ WHERE: [Action/direction given]

Character Count: [X]/500 ✅

CTA Tweet:
[Unique CTA specific to this content ending with link]

Character Count: [X]/500 ✅`;
}

// Generate tweets using Claude with your 2HourMan prompt
async function generateTweetsWithPrompt(emailContent, prompt) {
  try {
    const fullPrompt = `${prompt}

SOURCE CONTENT TO ANALYZE:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

Please analyze this content and create 3-5 tweets following the 2HourMan methodology outlined above. Ensure each tweet has a single aha moment, complete What-Why-Where cycles, and follows all core principles.

Format your response with the exact structure specified in the prompt above.`;

    console.log('\n📤 SENDING TO CLAUDE WITH 2HOURMAN PROMPT:');
    console.log('Full prompt length:', fullPrompt.length);
    console.log('Using model:', process.env.CLAUDE_MODEL_NAME);

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME,
      max_tokens: 8000, // Increased for detailed analysis
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    
    console.log('\n📥 CLAUDE RESPONSE WITH 2HOURMAN ANALYSIS:');
    console.log('Response length:', content.length);
    console.log('First 500 characters:', content.substring(0, 500));
    
    // Parse the structured response
    const tweets = parseStructuredTweetResponse(content);
    
    console.log(`✅ Parsed ${tweets.length} structured tweets`);
    
    return { tweets };

  } catch (error) {
    console.error('❌ Error generating tweets with 2HourMan prompt:', error);
    
    // Fallback response
    return {
      tweets: [{
        title: 'Error in Tweet Generation',
        content: `An error occurred while generating tweets using the 2HourMan methodology.\n\nError: ${error.message}\n\nPlease check the system logs for details.`,
        aha_moment: 'Error occurred',
        what_why_where: 'Error in processing',
        character_count: 'N/A',
        cta: 'Please check the system logs for details.'
      }]
    };
  }
}

// Parse Claude's structured response into usable tweet objects
function parseStructuredTweetResponse(content) {
  const tweets = [];
  
  try {
    // Split content by tweet sections
    const tweetSections = content.split(/TWEET #\d+:/);
    
    // Remove empty first element
    if (tweetSections[0].trim() === '') {
      tweetSections.shift();
    }
    
    tweetSections.forEach((section, index) => {
      try {
        const tweetNum = index + 1;
        
        // Extract different components using regex patterns
        const titleMatch = section.match(/^([^\n]+)/);
        const contentMatch = section.match(/Main Content:\s*([\s\S]*?)(?=\n\nSingle Aha Moment:|$)/);
        const ahaMatch = section.match(/Single Aha Moment:\s*([\s\S]*?)(?=\n\nWhat-Why-Where|$)/);
        const whatWhyWhereMatch = section.match(/What-Why-Where Check:\s*([\s\S]*?)(?=\n\nCharacter Count:|$)/);
        const ctaMatch = section.match(/CTA Tweet:\s*([\s\S]*?)(?=\n\nCharacter Count:|$)/);
        
        const tweet = {
          number: tweetNum,
          title: titleMatch ? titleMatch[1].trim() : `Tweet ${tweetNum}`,
          content: contentMatch ? contentMatch[1].trim() : 'Content extraction failed',
          aha_moment: ahaMatch ? ahaMatch[1].trim() : 'Aha moment not identified',
          what_why_where: whatWhyWhereMatch ? whatWhyWhereMatch[1].trim() : 'Cycle analysis missing',
          cta: ctaMatch ? ctaMatch[1].trim() : 'CTA not found',
          character_count: contentMatch ? contentMatch[1].trim().length : 0
        };
        
        tweets.push(tweet);
        
        console.log(`✅ Parsed Tweet ${tweetNum}: "${tweet.title}"`);
        
      } catch (parseError) {
        console.error(`❌ Error parsing tweet section ${index + 1}:`, parseError);
        
        // Add error tweet
        tweets.push({
          number: index + 1,
          title: `Tweet ${index + 1} - Parse Error`,
          content: 'Failed to parse this tweet section from Claude response.',
          aha_moment: 'Parse error occurred',
          what_why_where: 'Unable to extract cycle analysis',
          cta: 'Check logs for details',
          character_count: 0
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Error parsing structured response:', error);
    
    // Return the raw content as a single tweet if parsing fails
    tweets.push({
      number: 1,
      title: 'Raw Claude Response',
      content: content,
      aha_moment: 'Unable to parse structured response',
      what_why_where: 'Structure parsing failed',
      cta: 'Review raw response above',
      character_count: content.length
    });
  }
  
  return tweets;
}

// Create pages in Short Form database with proper 2HourMan structure
async function createShortFormPages(tweetsData, emailPageId) {
  try {
    const results = [];

    console.log('\n📝 CREATING PAGES WITH 2HOURMAN STRUCTURE:');
    console.log(`Processing ${tweetsData.tweets.length} structured tweets...`);

    for (let i = 0; i < tweetsData.tweets.length; i++) {
      const tweet = tweetsData.tweets[i];
      
      console.log(`\n🧵 CREATING PAGE FOR TWEET ${i + 1}:`);
      console.log(`Title: ${tweet.title}`);
      console.log(`Content length: ${tweet.content.length} characters`);

      // Create structured blocks for each tweet
      const blocks = [];
      
      // Title block
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: `TWEET #${tweet.number}: ${tweet.title}` }
          }]
        }
      });
      
      // Main Content section
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{
            type: 'text',
            text: { content: 'Main Content:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: tweet.content }
          }]
        }
      });
      
      // Single Aha Moment section
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{
            type: 'text',
            text: { content: 'Single Aha Moment:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: tweet.aha_moment }
          }]
        }
      });
      
      // What-Why-Where Check section
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{
            type: 'text',
            text: { content: 'What-Why-Where Check:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: tweet.what_why_where }
          }]
        }
      });
      
      // Character Count
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: `Character Count: ${tweet.character_count}/500 ${tweet.character_count <= 500 ? '✅' : '❌'}` }
          }]
        }
      });
      
      // Divider
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      
      // CTA Tweet section
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{
            type: 'text',
            text: { content: 'CTA Tweet:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: tweet.cta }
          }]
        }
      });

      try {
        // Create the page with structured blocks
        const response = await notion.pages.create({
          parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
          properties: {
            'Title': {
              title: [{ text: { content: `TWEET #${tweet.number}: ${tweet.title}` } }]
            },
            'E-mails': {
              relation: [{ id: emailPageId }]
            }
          },
          children: blocks
        });

        console.log(`✅ Successfully created structured page ${i + 1}: ${response.id}`);
        console.log(`   Title: TWEET #${tweet.number}: ${tweet.title}`);
        console.log(`   Blocks added: ${blocks.length}`);
        
        results.push({ 
          id: response.id, 
          title: `TWEET #${tweet.number}: ${tweet.title}`,
          blocks_count: blocks.length,
          tweet_number: tweet.number
        });

      } catch (pageError) {
        console.error(`❌ Failed to create page ${i + 1}:`, pageError);
        
        // Create minimal fallback page
        try {
          const fallbackResponse = await notion.pages.create({
            parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
            properties: {
              'Title': {
                title: [{ text: { content: `Tweet ${i + 1} - Creation Error` } }]
              },
              'E-mails': {
                relation: [{ id: emailPageId }]
              }
            },
            children: [{
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{
                  type: 'text',
                  text: { content: `Error creating structured page for tweet ${i + 1}. Check logs for details.\n\nOriginal content:\n${tweet.content}` }
                }]
              }
            }]
          });
          
          results.push({ 
            id: fallbackResponse.id, 
            title: `Tweet ${i + 1} - Error`,
            error: true
          });
        } catch (fallbackError) {
          console.error(`❌ Even fallback creation failed for tweet ${i + 1}:`, fallbackError);
        }
      }
    }

    console.log(`\n✅ COMPLETED: Created ${results.length} structured pages total`);
    return results;

  } catch (error) {
    console.error('❌ Error in createShortFormPages:', error);
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
  console.log(`🔧 Version: 11.0 - 2HourMan Tweet Prompt Integration`);
  console.log(`📝 Using prompt from Notion page: ${process.env.PROMPT_PAGE_ID || 'Default fallback'}`);
});
