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

// NEW: Import the enhanced content generator
const EnhancedContentGenerator = require('./enhanced-content-generator');
const contentGenerator = new EnhancedContentGenerator(anthropic, null);

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
    version: '14.0 - Multi-Pass Generation System',
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
        newsletterLink: process.env.NEWSLETTER_LINK || 'Not Set',
        multiPassEnabled: process.env.ENABLE_MULTIPASS || 'false',
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
    console.log('📝 Step 4: Getting content creation prompt from Notion...');
    const prompt = await getPromptFromNotion();
    console.log('✅ Content creation prompt retrieved from Notion');

    // Step 5: Generate tweets using enhanced multi-pass approach
    console.log('🤖 Step 5: Generating tweets with enhanced quality approach...');
    const startTime = Date.now();
    
    const tweetsData = await generateTweetsWithEnhancedQuality(emailContent, prompt);
    
    // Log generation metrics
    logGenerationMetrics(tweetsData, startTime);
    
    console.log(`✅ Generated ${tweetsData.tweetConcepts.length} tweet concepts with enhanced quality`);

    // Step 6: Create pages with complete structure
    console.log('📝 Step 6: Creating full structure pages...');
    const createdPages = await createFullStructurePages(tweetsData, pageId);
    console.log(`✅ Created ${createdPages.length} pages with complete structure`); 

    console.log('🎉 === AUTOMATION COMPLETED ===');
    return {
      status: 'success',
      email_page_id: pageId,
      content_length: emailContent.length,
      concepts_generated: tweetsData.tweetConcepts.length,
      pages_created: createdPages.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Automation processing error:', error);
    throw new Error(`Automation failed: ${error.message}`);
  }
}

// ENHANCED: Multi-pass tweet generation with quality improvement
async function generateTweetsWithEnhancedQuality(emailContent, prompt) {
  const useMultiPass = process.env.ENABLE_MULTIPASS === 'true';
  
  if (useMultiPass) {
    console.log('🎯 Using Multi-Pass Generation System');
    try {
      // Set the base prompt on the generator
      contentGenerator.basePrompt = prompt;
      
      // Use multi-pass generation
      const result = await contentGenerator.generateTweetsWithMultiPass(
        emailContent, 
        process.env.NEWSLETTER_LINK
      );
      
      console.log('✅ Multi-Pass Generation Complete');
      return result;
      
    } catch (error) {
      console.error('❌ Multi-pass generation failed, falling back to single-pass:', error);
      // Fall through to single-pass generation
    }
  }
  
  console.log('⚡ Using Single-Pass Generation');
  
  // Original single-pass approach (fallback or when multi-pass disabled)
  const response = await anthropic.messages.create({
    model: process.env.CLAUDE_MODEL_NAME || 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    messages: [{ 
      role: 'user', 
      content: `${prompt}\n\nEMAIL CONTENT:\n${emailContent}` 
    }]
  });

  try {
    return JSON.parse(response.content[0].text);
  } catch (e) {
    console.error('❌ JSON parsing failed in single-pass generation');
    throw new Error('Failed to parse generation response');
  }
}

// NEW: Enhanced monitoring function to track improvement
function logGenerationMetrics(result, startTime) {
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  console.log('\n📈 GENERATION METRICS:');
  console.log(`⏱️  Total Time: ${duration}ms`);
  console.log(`📝 Concepts Generated: ${result.tweetConcepts.length}`);
  
  let totalPosts = 0;
  let avgCharCount = 0;
  let overLimitCount = 0;
  
  result.tweetConcepts.forEach(tweet => {
    totalPosts += tweet.mainContent.posts.length;
    tweet.mainContent.posts.forEach(post => {
      avgCharCount += post.length;
      if (post.length > 500) overLimitCount++;
    });
  });
  
  avgCharCount = Math.round(avgCharCount / totalPosts);
  
  console.log(`📊 Total Posts: ${totalPosts}`);
  console.log(`📏 Avg Character Count: ${avgCharCount}`);
  console.log(`⚠️  Over Limit Posts: ${overLimitCount}`);
  console.log(`✅ Quality Score: ${overLimitCount === 0 ? 'PASS' : 'NEEDS REVIEW'}`);
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
      if (block.type === 'paragraph' && block.paragraph?.rich_text) {
        const text = block.paragraph.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        content += text + '\n';
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
        const text = block.bulleted_list_item.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        content += '• ' + text + '\n';
      } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
        const text = block.numbered_list_item.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        content += '1. ' + text + '\n';
      } else if (block.type === 'heading_1' && block.heading_1?.rich_text) {
        const text = block.heading_1.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        content += '# ' + text + '\n';
      } else if (block.type === 'heading_2' && block.heading_2?.rich_text) {
        const text = block.heading_2.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        content += '## ' + text + '\n';
      } else if (block.type === 'heading_3' && block.heading_3?.rich_text) {
        const text = block.heading_3.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        content += '### ' + text + '\n';
      }
    }

    return content.trim();
  } catch (error) {
    console.error('❌ Error extracting email content:', error);
    throw new Error(`Failed to extract email content: ${error.message}`);
  }
}

// Get prompt from Notion page
async function getPromptFromNotion() {
  const promptPageId = process.env.PROMPT_PAGE_ID;
  
  if (!promptPageId) {
    console.log('⚠️ No PROMPT_PAGE_ID provided, using simplified fallback');
    return `
Transform this email content into 5 high-quality tweet concepts.

Create tweets that:
- Have strong hooks that grab attention
- Include clear value propositions
- Are under 500 characters per post
- Have specific CTAs that reference the content
- Include proper What-Why-Where cycles

Respond in JSON format with exactly 5 tweet concepts, each having:
- number, title, mainContent (posts array), characterCounts, ahamoment, cta, qualityValidation
`;
  }

  try {
    const response = await notion.blocks.children.list({
      block_id: promptPageId,
      page_size: 100
    });

    let promptContent = '';
    
    for (const block of response.results) {
      if (block.type === 'paragraph' && block.paragraph?.rich_text) {
        const text = block.paragraph.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        promptContent += text + '\n';
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
        const text = block.bulleted_list_item.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        promptContent += '• ' + text + '\n';
      } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
        const text = block.numbered_list_item.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        promptContent += '1. ' + text + '\n';
      } else if (block.type === 'heading_1' && block.heading_1?.rich_text) {
        const text = block.heading_1.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        promptContent += '# ' + text + '\n';
      } else if (block.type === 'heading_2' && block.heading_2?.rich_text) {
        const text = block.heading_2.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        promptContent += '## ' + text + '\n';
      } else if (block.type === 'heading_3' && block.heading_3?.rich_text) {
        const text = block.heading_3.rich_text
          .map(textObj => textObj.plain_text || '')
          .join('');
        promptContent += '### ' + text + '\n';
      }
    }

    console.log(`✅ Retrieved ${promptContent.length} characters of prompt content from Notion`);
    return promptContent.trim();

  } catch (error) {
    console.error('❌ Error retrieving prompt from Notion:', error);
    console.log('⚠️ Falling back to simplified prompt');
    return `
Transform this email content into 5 high-quality tweet concepts.

Create tweets that:
- Have strong hooks that grab attention
- Include clear value propositions
- Are under 500 characters per post
- Have specific CTAs that reference the content
- Include proper What-Why-Where cycles

Respond in JSON format with exactly 5 tweet concepts, each having:
- number, title, mainContent (posts array), characterCounts, ahamoment, cta, qualityValidation
`;
  }
}

// Create full structure pages in Notion
async function createFullStructurePages(tweetsData, emailPageId) {
  try {
    console.log('\n📝 Creating full structure pages...');
    console.log(`📊 Processing ${tweetsData.tweetConcepts.length} tweet concepts`);
    
    const results = [];
    
    for (let i = 0; i < tweetsData.tweetConcepts.length; i++) {
      const concept = tweetsData.tweetConcepts[i];
      console.log(`\n🔨 Creating page ${i + 1}: "${concept.title}"`);
      
      const blocks = [];
      
      // Main Content section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Main Content:' }
          }]
        }
      });
      
      // Add each post with character count and dividers
      concept.mainContent.posts.forEach((post, postIndex) => {
        // Add the post content
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: post }
            }]
          }
        });
        
        // Add character count right after each post
        const charCount = concept.mainContent.characterCounts[postIndex] || `${post.length}/500 ${post.length <= 500 ? '✅' : '❌'}`;
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: `Character Count: ${charCount}` },
              annotations: { 
                color: 'gray',
                italic: true
              }
            }]
          }
        });
        
        // Add divider between posts (but not after the last one)
        if (postIndex < concept.mainContent.posts.length - 1) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: '---' },
                annotations: { 
                  bold: true,
                  color: 'blue'
                }
              }]
            }
          });
        }
      });
      
      // Single Aha Moment section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
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
            text: { content: concept.ahamoment }
          }]
        }
      });
      
      // Divider before CTA
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      
      // CTA Tweet section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
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
            text: { content: concept.cta }
          }]
        }
      });
      
      // CTA Character count with validation
      const ctaLength = concept.cta.length;
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: `CTA Character Count: ${ctaLength}/500 ${ctaLength <= 500 ? '✅' : '❌'}` },
            annotations: { 
              color: ctaLength <= 500 ? 'green' : 'red',
              italic: true
            }
          }]
        }
      });
      
      // Quality Validation section
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Quality Validation:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: concept.qualityValidation }
          }]
        }
      });

      try {
        // Create the page with full structure
        const response = await notion.pages.create({
          parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
          properties: {
            'Title': {
              title: [{ text: { content: `TWEET #${concept.number}: ${concept.title}` } }]
            },
            'E-mails': {
              relation: [{ id: emailPageId }]
            }
          },
          children: blocks
        });

        console.log(`✅ Successfully created page ${i + 1}: ${response.id}`);
        console.log(`   Title: TWEET #${concept.number}: ${concept.title}`);
        console.log(`   Blocks added: ${blocks.length}`);
        console.log(`   Posts: ${concept.mainContent.posts.length}`);
        console.log(`   CTA length: ${concept.cta.length} characters`);
        
        results.push({ 
          id: response.id, 
          title: `TWEET #${concept.number}: ${concept.title}`,
          blocks_count: blocks.length,
          posts_count: concept.mainContent.posts.length,
          concept_number: concept.number,
          cta_length: concept.cta.length
        });

      } catch (pageError) {
        console.error(`❌ Failed to create page ${i + 1}:`, pageError);
        
        // Create minimal fallback page
        try {
          const fallbackResponse = await notion.pages.create({
            parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
            properties: {
              'Title': {
                title: [{ text: { content: `Concept ${i + 1} - Creation Error` } }]
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
                  text: { content: `Error creating page for concept ${i + 1}. Check logs for details.` }
                }]
              }
            }]
          });
          
          results.push({ 
            id: fallbackResponse.id, 
            title: `Concept ${i + 1} - Error`,
            error: true
          });
        } catch (fallbackError) {
          console.error(`❌ Even fallback creation failed for concept ${i + 1}:`, fallbackError);
        }
      }
    }

    console.log(`\n✅ COMPLETED: Created ${results.length} pages with proper structure`);
    return results;

  } catch (error) {
    console.error('❌ Error in createFullStructurePages:', error);
    throw new Error(`Failed to create full structure pages in Notion: ${error.message}`);
  }
}

// Validate environment on startup
if (!validateEnvironment()) {
  console.error('❌ Server starting with missing environment variables. Functionality will be impaired.');
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Email-to-Tweet server running on port ${PORT}`);
  console.log(`🔧 Version: 14.0 - Multi-Pass Generation System`);
  console.log(`📝 Using prompt from Notion page: ${process.env.PROMPT_PAGE_ID || 'Simplified fallback'}`);
  console.log(`🔗 Newsletter link: ${process.env.NEWSLETTER_LINK || 'Not set'}`);
  console.log(`🎯 Multi-Pass Generation: ${process.env.ENABLE_MULTIPASS === 'true' ? 'ENABLED' : 'DISABLED'}`);
});
