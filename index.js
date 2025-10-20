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
    version: '10.13 - Claude JSON Structure Fix', // Version update
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

// Get prompt from Notion page
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

Format your response as valid JSON with tweets as simple strings:
{
  "threads": [
    {
      "title": "Thread concept title",
      "tweets": ["Tweet 1 text", "Tweet 2 text", "Tweet 3 text", "Tweet 4 text"]
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

// Generate tweets using Claude - WITH COMPREHENSIVE DEBUGGING AND BETTER ERROR HANDLING
async function generateTweets(emailContent, prompt) {
  try {
    const fullPrompt = `${prompt}

EMAIL CONTENT:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

Generate 5 Twitter thread concepts in JSON format. Your entire response MUST be the single, valid JSON object starting with {"threads": [...]}.

CRITICAL: Each tweet must be a simple string, not an object. Use this exact format:
{
  "threads": [
    {
      "title": "Thread concept title",
      "tweets": ["Tweet 1 text", "Tweet 2 text", "Tweet 3 text"]
    }
  ]
}`;

    console.log('\n📤 SENDING TO CLAUDE:');
    console.log('Prompt length:', fullPrompt.length);
    console.log('Model:', process.env.CLAUDE_MODEL_NAME);

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME,
      max_tokens: 4000,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    
    console.log('\n📥 CLAUDE RESPONSE DEBUG:');
    console.log('Raw response length:', content.length);
    console.log('First 500 characters:', content.substring(0, 500));
    
    // IMPROVED JSON EXTRACTION - handle malformed JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      console.log('✅ JSON found in response');
      
      let jsonString = jsonMatch[0];
      
      // ATTEMPT TO FIX COMMON JSON ISSUES
      try {
        // Try parsing as-is first
        const parsed = JSON.parse(jsonString);
        
        console.log('\n🔍 PARSED JSON STRUCTURE:');
        console.log('Parsed type:', typeof parsed);
        console.log('Has threads property:', 'threads' in parsed);
        console.log('Threads type:', typeof parsed.threads);
        console.log('Threads is array:', Array.isArray(parsed.threads));
        console.log('Threads length:', parsed.threads?.length);
        
        if (parsed.threads && parsed.threads.length > 0) {
          console.log('\n📋 FIRST THREAD ANALYSIS:');
          const firstThread = parsed.threads[0];
          console.log('Thread structure:', JSON.stringify(firstThread, null, 2));
          
          // NORMALIZE THE THREAD STRUCTURE TO HANDLE CLAUDE'S VARIATIONS
          const normalizedThreads = parsed.threads.map((thread, index) => {
            console.log(`\n🔧 NORMALIZING THREAD ${index + 1}:`);
            console.log('Original thread:', JSON.stringify(thread, null, 2));
            
            // Extract title from various possible properties
            const title = thread.title || thread.concept || thread.name || thread.hook || `Generated Thread ${index + 1}`;
            
            // Extract tweets and normalize them
            let tweets = [];
            
            if (Array.isArray(thread.tweets)) {
              tweets = thread.tweets.map((tweet, tweetIndex) => {
                console.log(`Tweet ${tweetIndex + 1} type:`, typeof tweet);
                console.log(`Tweet ${tweetIndex + 1} value:`, tweet);
                
                // Handle different tweet formats
                if (typeof tweet === 'string') {
                  return tweet;
                } else if (typeof tweet === 'object' && tweet !== null) {
                  // Extract content from object tweets
                  const tweetContent = tweet.content || tweet.text || tweet.message || tweet.tweet || JSON.stringify(tweet);
                  console.log(`Extracted content: "${tweetContent}"`);
                  return String(tweetContent);
                } else {
                  return String(tweet);
                }
              });
            } else if (typeof thread.tweets === 'string') {
              tweets = [thread.tweets];
            } else {
              // Fallback: create tweets from other thread properties
              tweets = [
                thread.hook || thread.title || 'Tweet 1',
                thread.content || 'Tweet 2',
                thread.cta || thread.callToAction || 'Tweet 3'
              ].filter(Boolean);
            }
            
            const normalizedThread = { title, tweets };
            console.log(`Normalized thread ${index + 1}:`, JSON.stringify(normalizedThread, null, 2));
            
            return normalizedThread;
          });
          
          console.log('\n✅ ALL THREADS NORMALIZED');
          return { threads: normalizedThreads };
        }
        
        return parsed;
        
      } catch (parseError) {
        console.error('❌ JSON Parse Error:', parseError);
        console.error('Failed JSON (first 1000 chars):', jsonString.substring(0, 1000));
        
        // ATTEMPT MANUAL JSON REPAIR
        console.log('🔧 Attempting JSON repair...');
        
        // Common fixes for malformed JSON
        jsonString = jsonString
          .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":')  // Quote unquoted keys
          .replace(/:\s*'([^']*)'/g, ': "$1"')  // Replace single quotes with double
          .replace(/\n/g, '\\n')  // Escape newlines in strings
          .replace(/\t/g, '\\t');  // Escape tabs in strings
        
        try {
          const repairedParsed = JSON.parse(jsonString);
          console.log('✅ JSON repair successful');
          return repairedParsed;
        } catch (repairError) {
          console.error('❌ JSON repair failed:', repairError);
          
          // ULTIMATE FALLBACK: Create a basic structure
          console.log('🚨 Using fallback thread structure');
          return {
            threads: [{
              title: 'Fallback Thread',
              tweets: [
                'Content generation encountered an error.',
                'Please check the logs for details.',
                'The original email content was processed but Claude returned invalid JSON.'
              ]
            }]
          };
        }
      }
    } else {
      console.error('❌ No JSON found in Claude response');
      console.error('Full response:', content);
      
      // FALLBACK: Create basic structure from response text
      return {
        threads: [{
          title: 'Text Response Thread',
          tweets: [
            'Claude returned text instead of JSON.',
            content.substring(0, 200) + '...',
            'Please check the prompt formatting.'
          ]
        }]
      };
    }
  } catch (error) {
    if (error.status && error.status !== 404) {
      console.error(`Claude API Error: Status ${error.status}. Check API key and billing.`);
    }
    console.error('Full error:', error);
    
    // FINAL FALLBACK
    return {
      threads: [{
        title: 'Error Thread',
        tweets: [
          'An error occurred during content generation.',
          `Error: ${error.message}`,
          'Please check the system logs for details.'
        ]
      }]
    };
  }
}

// COMPLETELY FIXED: Create pages in Short Form database
async function createShortFormPages(tweetsData, emailPageId) {
  try {
    const results = [];

    console.log('\n📝 CREATING PAGES - FULL DEBUG:');
    console.log('tweetsData type:', typeof tweetsData);
    console.log('tweetsData structure:', JSON.stringify(tweetsData, null, 2));

    // Check if threads exists AND is an array before iterating
    if (!Array.isArray(tweetsData.threads)) {
      throw new Error(`Expected 'threads' property from Claude to be an array, but received ${typeof tweetsData.threads}`);
    }

    console.log(`Processing ${tweetsData.threads.length} threads...`);

    // Process each thread separately - create one Notion page per thread
    for (let i = 0; i < tweetsData.threads.length; i++) {
      const thread = tweetsData.threads[i];
      
      console.log(`\n🧵 PROCESSING THREAD ${i + 1}:`);
      console.log('Thread structure:', JSON.stringify(thread, null, 2));
      
      // Ensure tweets array exists and convert to strings
      let threadTweets = [];
      
      if (Array.isArray(thread.tweets)) {
        threadTweets = thread.tweets.map((tweet, tweetIndex) => {
          console.log(`Tweet ${tweetIndex + 1} type:`, typeof tweet);
          console.log(`Tweet ${tweetIndex + 1} content:`, tweet);
          
          // Convert to string explicitly - should now already be strings from normalization
          return String(tweet).trim();
        });
      } else {
        console.log(`⚠️ Thread ${i + 1} tweets is not an array:`, thread.tweets);
        threadTweets = [`Thread ${i + 1}: Invalid tweet format`];
      }

      console.log(`Final processed tweets for thread ${i + 1}:`, threadTweets);

      // Create blocks for this specific thread
      const threadBlocks = [];
      
      // Add each tweet as a separate paragraph block
      threadTweets.forEach((tweet, j) => {
        const tweetContent = String(tweet).trim();
        
        if (tweetContent && tweetContent !== 'undefined' && tweetContent !== 'null') {
          console.log(`Adding tweet ${j + 1}: "${tweetContent.substring(0, 50)}..."`);
          
          threadBlocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: tweetContent }
              }]
            }
          });
          
          // Add divider between tweets (except after last tweet)
          if (j < threadTweets.length - 1) {
            threadBlocks.push({
              object: 'block',
              type: 'divider',
              divider: {}
            });
          }
        }
      });

      console.log(`Created ${threadBlocks.length} blocks for thread ${i + 1}`);

      // If no valid blocks, create a fallback
      if (threadBlocks.length === 0) {
        threadBlocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: `Thread ${i + 1}: No valid content could be processed` }
            }]
          }
        });
      }

      try {
        // Create the page with blocks
        const response = await notion.pages.create({
          parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
          properties: {
            'Title': {
              title: [{ text: { content: thread.title || `Generated Thread ${i + 1}` } }]
            },
            'E-mails': {
              relation: [{ id: emailPageId }]
            }
          },
          children: threadBlocks
        });

        console.log(`✅ Successfully created page ${i + 1}: ${response.id}`);
        console.log(`   Title: ${thread.title || `Generated Thread ${i + 1}`}`);
        console.log(`   Blocks added: ${threadBlocks.length}`);
        
        results.push({ 
          id: response.id, 
          title: thread.title || `Generated Thread ${i + 1}`,
          blocks_count: threadBlocks.length
        });

      } catch (pageError) {
        console.error(`❌ Failed to create page ${i + 1}:`, pageError);
        
        // Create a minimal fallback page
        try {
          const fallbackResponse = await notion.pages.create({
            parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
            properties: {
              'Title': {
                title: [{ text: { content: `Thread ${i + 1} - Error` } }]
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
                  text: { content: `Error creating content for thread ${i + 1}. Check logs for details.` }
                }]
              }
            }]
          });
          
          results.push({ 
            id: fallbackResponse.id, 
            title: `Thread ${i + 1} - Error`,
            error: true
          });
        } catch (fallbackError) {
          console.error(`❌ Even fallback creation failed for thread ${i + 1}:`, fallbackError);
        }
      }
    }

    console.log(`\n✅ COMPLETED: Created ${results.length} pages total`);
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
  console.log(`🔧 Version: 10.13 - Claude JSON Structure Fix`);
});



