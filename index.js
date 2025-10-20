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
    version: '11.1 - Robust Parsing & Notion Prompt', // Version update
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

    // Step 4: Get processing prompt from Notion (your preference!)
    console.log('📝 Step 4: Getting 2HourMan tweet prompt from Notion...');
    const prompt = await getPromptFromNotion();
    console.log('✅ 2HourMan tweet prompt retrieved from Notion');

    // Step 5: Generate tweets using Claude with simplified, more robust approach
    console.log('🤖 Step 5: Generating tweets with 2HourMan methodology...');
    const tweetsData = await generateTweetsSimplified(emailContent, prompt);
    console.log(`✅ Generated ${tweetsData.tweets.length} tweets`);

    // Step 6: Create pages in Short Form database with simple, reliable formatting
    console.log('📝 Step 6: Creating Short Form pages...');
    const createdPages = await createShortFormPagesSimplified(tweetsData, pageId);
    console.log(`✅ Created ${createdPages.length} pages in Short Form database`); 

    console.log('🎉 === AUTOMATION COMPLETED ===');
    return {
      status: 'success',
      email_page_id: pageId,
      content_length: emailContent.length,
      tweets_generated: tweetsData.tweets.length,
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

// ROBUST: Get prompt from Notion page with better error handling
async function getPromptFromNotion() {
  try {
    console.log(`🔍 Reading 2HourMan prompt from Notion page ID: ${process.env.PROMPT_PAGE_ID}`);
    
    if (!process.env.PROMPT_PAGE_ID) {
      console.log('⚠️ No PROMPT_PAGE_ID set, using simplified fallback prompt');
      return getSimplifiedPrompt();
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
      console.log('⚠️ Prompt page appears to be empty, using simplified fallback');
      return getSimplifiedPrompt();
    }

    console.log(`✅ Successfully extracted ${finalPrompt.length} characters from Notion prompt page`);
    console.log(`📝 Prompt preview: ${finalPrompt.substring(0, 200)}...`);
    
    return finalPrompt;

  } catch (error) {
    console.error('❌ Error fetching prompt from Notion:', error);
    console.log('🔄 Falling back to simplified prompt');
    return getSimplifiedPrompt();
  }
}

// Simplified fallback prompt
function getSimplifiedPrompt() {
  return `You are a content extraction specialist for the 2 Hour Man brand. Transform content into high-quality tweets.

For each tweet, ensure:

1. SINGLE AHA MOMENT: One clear insight that everything builds toward
2. WHAT-WHY-WHERE CYCLES:
   - WHAT: Define the concept clearly (no jargon without explanation)
   - WHY: Show why it matters (mechanism, not just naming)
   - WHERE: Give clear direction on what to do

3. CORE PRINCIPLES:
   - Explain mechanisms, don't just name them
   - Use actual concepts from source content
   - No formulaic markers ("Result:", "Key takeaway:", etc.)
   - Natural, conversational flow

Create 3-5 tweets. For each, provide:
- Main tweet content
- Brief explanation of the aha moment
- Character count

Keep tweets under 500 characters each.`;
}

// SIMPLIFIED: Generate tweets with more robust parsing
async function generateTweetsSimplified(emailContent, prompt) {
  try {
    const fullPrompt = `${prompt}

SOURCE CONTENT TO ANALYZE:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

Please create 3-5 tweets following the 2HourMan methodology. 

Format each tweet like this:

TWEET 1:
[Main tweet content here]

AHA MOMENT: [Brief description of the insight]

---

TWEET 2:
[Main tweet content here]

AHA MOMENT: [Brief description of the insight]

---

Continue for all tweets. Keep each tweet under 500 characters.`;

    console.log('\n📤 SENDING SIMPLIFIED REQUEST TO CLAUDE:');
    console.log('Full prompt length:', fullPrompt.length);

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME,
      max_tokens: 6000,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    
    console.log('\n📥 CLAUDE RESPONSE:');
    console.log('Response length:', content.length);
    console.log('First 800 characters:', content.substring(0, 800));
    
    // ROBUST PARSING: Handle various response formats
    const tweets = parseSimplifiedResponse(content);
    
    console.log(`✅ Successfully parsed ${tweets.length} tweets`);
    
    return { tweets };

  } catch (error) {
    console.error('❌ Error generating tweets:', error);
    
    // Fallback response
    return {
      tweets: [{
        number: 1,
        content: `Error generating tweets: ${error.message}\n\nPlease check the system logs for details.`,
        aha_moment: 'Error occurred during tweet generation',
        character_count: 0
      }]
    };
  }
}

// ROBUST: Parse Claude's response with multiple fallback strategies
function parseSimplifiedResponse(content) {
  const tweets = [];
  
  try {
    console.log('\n🔍 PARSING CLAUDE RESPONSE:');
    
    // Strategy 1: Look for "TWEET X:" pattern
    const tweetMatches = content.match(/TWEET\s+\d+:\s*([\s\S]*?)(?=TWEET\s+\d+:|$)/gi);
    
    if (tweetMatches && tweetMatches.length > 0) {
      console.log(`✅ Found ${tweetMatches.length} tweets using TWEET pattern`);
      
      tweetMatches.forEach((match, index) => {
        try {
          // Extract content and aha moment
          const contentMatch = match.match(/TWEET\s+\d+:\s*([\s\S]*?)(?=AHA MOMENT:|---|\n\n|$)/i);
          const ahaMatch = match.match(/AHA MOMENT:\s*([\s\S]*?)(?=---|$)/i);
          
          const tweetContent = contentMatch ? contentMatch[1].trim() : `Tweet ${index + 1} content extraction failed`;
          const ahaContent = ahaMatch ? ahaMatch[1].trim() : 'Aha moment not identified';
          
          tweets.push({
            number: index + 1,
            content: tweetContent,
            aha_moment: ahaContent,
            character_count: tweetContent.length
          });
          
          console.log(`✅ Parsed Tweet ${index + 1}: ${tweetContent.substring(0, 50)}...`);
          
        } catch (parseError) {
          console.error(`❌ Error parsing tweet ${index + 1}:`, parseError);
          
          tweets.push({
            number: index + 1,
            content: `Tweet ${index + 1}: Parse error occurred`,
            aha_moment: 'Could not parse aha moment',
            character_count: 0
          });
        }
      });
    } else {
      console.log('⚠️ No TWEET pattern found, trying alternative parsing...');
      
      // Strategy 2: Split by line breaks and look for substantial content
      const lines = content.split('\n').filter(line => line.trim().length > 20);
      
      if (lines.length > 0) {
        console.log(`📄 Found ${lines.length} substantial lines, creating tweets from top content`);
        
        // Take the first few substantial paragraphs as tweets
        const maxTweets = Math.min(3, lines.length);
        
        for (let i = 0; i < maxTweets; i++) {
          const line = lines[i].trim();
          
          tweets.push({
            number: i + 1,
            content: line,
            aha_moment: `Insight ${i + 1} from content analysis`,
            character_count: line.length
          });
          
          console.log(`✅ Created Tweet ${i + 1} from line: ${line.substring(0, 50)}...`);
        }
      } else {
        console.log('❌ No parseable content found, creating fallback tweet');
        
        // Strategy 3: Use raw content as single tweet
        const fallbackContent = content.substring(0, 400).trim();
        
        tweets.push({
          number: 1,
          content: fallbackContent || 'Failed to extract meaningful content from response',
          aha_moment: 'Unable to identify specific aha moment',
          character_count: fallbackContent.length
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Complete parsing failure:', error);
    
    // Final fallback
    tweets.push({
      number: 1,
      content: 'Tweet parsing failed completely. Check logs for details.',
      aha_moment: 'Parse error occurred',
      character_count: 0
    });
  }
  
  console.log(`📊 Final parsing result: ${tweets.length} tweets created`);
  return tweets;
}

// SIMPLIFIED: Create pages with reliable, simple formatting
async function createShortFormPagesSimplified(tweetsData, emailPageId) {
  try {
    const results = [];

    console.log('\n📝 CREATING SIMPLIFIED PAGES:');
    console.log(`Processing ${tweetsData.tweets.length} tweets...`);

    for (let i = 0; i < tweetsData.tweets.length; i++) {
      const tweet = tweetsData.tweets[i];
      
      console.log(`\n🧵 CREATING PAGE FOR TWEET ${i + 1}:`);
      console.log(`Content: ${tweet.content.substring(0, 100)}...`);
      console.log(`Character count: ${tweet.character_count}`);

      // Create simple, reliable blocks
      const blocks = [];
      
      // Main tweet content
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: tweet.content },
            annotations: { bold: true }
          }]
        }
      });
      
      // Divider
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      
      // Aha moment
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: 'Aha Moment: ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: tweet.aha_moment }
            }
          ]
        }
      });
      
      // Character count
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

      try {
        // Create the page
        const response = await notion.pages.create({
          parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
          properties: {
            'Title': {
              title: [{ text: { content: `Tweet ${tweet.number}: ${tweet.aha_moment.substring(0, 50)}...` } }]
            },
            'E-mails': {
              relation: [{ id: emailPageId }]
            }
          },
          children: blocks
        });

        console.log(`✅ Successfully created page ${i + 1}: ${response.id}`);
        
        results.push({ 
          id: response.id, 
          title: `Tweet ${tweet.number}`,
          character_count: tweet.character_count
        });

      } catch (pageError) {
        console.error(`❌ Failed to create page ${i + 1}:`, pageError);
        
        // Simple fallback page
        try {
          const fallbackResponse = await notion.pages.create({
            parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
            properties: {
              'Title': {
                title: [{ text: { content: `Tweet ${i + 1} - Error` } }]
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
                  text: { content: `Error creating page. Original content: ${tweet.content}` }
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
          console.error(`❌ Even fallback failed for tweet ${i + 1}:`, fallbackError);
        }
      }
    }

    console.log(`\n✅ COMPLETED: Created ${results.length} pages`);
    return results;

  } catch (error) {
    console.error('❌ Error in createShortFormPagesSimplified:', error);
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
  console.log(`🔧 Version: 11.1 - Robust Parsing & Notion Prompt`);
  console.log(`📝 Using prompt from Notion page: ${process.env.PROMPT_PAGE_ID || 'Simplified fallback'}`);
});
