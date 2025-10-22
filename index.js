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

// CRITICAL FIX: Robust JSON extraction utility function
function extractJSON(text) {
  try {
    // Try parsing directly first
    return JSON.parse(text);
  } catch (e) {
    console.log('🔍 Direct JSON parse failed, trying extraction methods...');
    
    try {
      // Method 1: Extract from ```json blocks
      const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        console.log('✅ Found JSON in code block');
        return JSON.parse(jsonBlockMatch[1]);
      }

      // Method 2: Extract from ```javascript blocks  
      const jsBlockMatch = text.match(/```javascript\s*([\s\S]*?)\s*```/);
      if (jsBlockMatch) {
        console.log('✅ Found JSON in JS code block');
        return JSON.parse(jsBlockMatch[1]);
      }

      // Method 3: Find JSON object in text
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        console.log('✅ Found JSON object in text');
        return JSON.parse(objectMatch[0]);
      }

      // Method 4: Look for response after "Response:" or similar
      const responseMatch = text.match(/(?:Response|Result|Output):\s*(\{[\s\S]*\})/i);
      if (responseMatch) {
        console.log('✅ Found JSON after response indicator');
        return JSON.parse(responseMatch[1]);
      }

      throw new Error('No valid JSON found in response');
    } catch (parseError) {
      console.error('❌ All JSON extraction methods failed');
      console.error('Raw response:', text.substring(0, 200) + '...');
      throw new Error(`JSON extraction failed: ${parseError.message}`);
    }
  }
}

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
    version: '16.0 - Skills API Only',
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
        generationMode: 'Skills API Only',
        skillId: process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW',
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

// SKILLS API ONLY: Tweet generation using Skills API exclusively
async function generateTweetsWithEnhancedQuality(emailContent, prompt) {
  const skillId = process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW';

  console.log('🎯 Using Skills API for tweet generation');
  console.log(`📦 Skill ID: ${skillId}`);

  // Call the Skills API - no fallbacks
  const result = await generateTweetsWithSkills(emailContent, prompt, skillId);
  console.log('✅ Skills API Generation Complete');
  return result;
}

// NEW: Parse markdown output from the skill into structured tweet concepts
function parseSkillMarkdownOutput(markdown) {
  const concepts = [];

  // Split by ## TWEET markers
  const tweetSections = markdown.split(/##\s*TWEET\s*#(\d+):/);

  // Process each tweet section (skip first element which is intro text)
  for (let i = 1; i < tweetSections.length; i += 2) {
    const number = parseInt(tweetSections[i]);
    const content = tweetSections[i + 1];

    if (!content) continue;

    // Extract title from first line
    const lines = content.trim().split('\n');
    const title = lines[0].trim();

    // Extract all posts (content between ``` markers)
    const posts = [];
    const codeBlockRegex = /```\s*\n([\s\S]*?)\n```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      posts.push(match[1].trim());
    }

    // Last post is the CTA
    const cta = posts.length > 0 ? posts.pop() : '';
    const mainPosts = posts;

    if (mainPosts.length > 0) {
      concepts.push({
        number,
        title,
        concept: title,
        strategy: 'What-Why-Where cycle with contextual CTA',
        mainContent: {
          posts: mainPosts,
          characterCounts: mainPosts.map(p => `${p.length}/500 ${p.length <= 500 ? '✅' : '❌'}`)
        },
        cta: cta,
        ahamoment: mainPosts[0], // First post is usually the aha moment
        qualityValidation: `Generated by content-to-tweets skill with ${mainPosts.length} posts`
      });
    }
  }

  return concepts;
}

// NEW: Generate tweets using the Skills API with code execution container
async function generateTweetsWithSkills(emailContent, prompt, skillId) {
  try {
    console.log('🚀 Calling Skills API with code execution container...');

    // Build the user prompt for the skill
    // Be very explicit about what we want - multiple tweet options with full formatting
    const userPrompt = `Transform this email content into multiple high-quality Twitter thread options (aim for 5+ different tweet concepts).

For each tweet thread, follow the What-Why-Where cycle and include:
- Multiple posts (2-3 posts per thread)
- All posts under 500 characters
- Proper CTB (Contextual Benefits) structure for the CTA
- Posts in code blocks for easy copy-paste

EMAIL CONTENT:
${emailContent}

Newsletter Link: ${process.env.NEWSLETTER_LINK || 'Not provided'}

Generate multiple complete tweet thread options, each as a separate ## TWEET #N: section with all posts in code blocks.`;

    // Make the Skills API request using the container parameter
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-beta': 'code-execution-2025-08-25,skills-2025-10-02',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL_NAME || 'claude-3-7-sonnet-20250219',
        max_tokens: 8000, // Increased for multiple tweet options
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
    console.log('✅ Skills API response received');
    console.log(`   Stop reason: ${data.stop_reason}`);
    console.log(`   Content blocks: ${data.content?.length || 0}`);

    // Extract the content from the response
    if (!data.content || data.content.length === 0) {
      throw new Error('No content in Skills API response');
    }

    // Skills may return multiple content blocks (text + tool use results)
    let resultText = '';
    for (const block of data.content) {
      if (block.type === 'text') {
        resultText += block.text;
      }
    }

    if (!resultText) {
      throw new Error('No text content in Skills API response');
    }

    console.log('📝 Raw skill output length:', resultText.length, 'characters');
    console.log('📝 First 500 chars of output:', resultText.substring(0, 500));
    console.log('📝 Last 500 chars of output:', resultText.substring(Math.max(0, resultText.length - 500)));

    // Parse the markdown output from the skill
    // The skill returns formatted tweet threads in markdown with code blocks
    const tweetConcepts = parseSkillMarkdownOutput(resultText);

    console.log(`✅ Parsed ${tweetConcepts.length} tweet concepts from skill output`);

    if (tweetConcepts.length === 0) {
      console.log('⚠️  No concepts parsed. Full output:');
      console.log(resultText);
    }

    return { tweetConcepts };

  } catch (error) {
    console.error('❌ Skills API error:', error.message);
    throw error;
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
  
  result.tweetConcepts.forEach((concept, i) => {
    totalPosts += concept.mainContent.posts.length;
    concept.mainContent.posts.forEach(post => {
      avgCharCount += post.length;
      if (post.length > 500) overLimitCount++;
    });
    
    console.log(`📄 Concept ${i + 1}: ${concept.mainContent.posts.length} posts, CTA: ${concept.cta.length} chars`);
  });
  
  avgCharCount = Math.round(avgCharCount / totalPosts);
  
  console.log(`📊 Total Posts: ${totalPosts}`);
  console.log(`📊 Avg Character Count: ${avgCharCount}`);
  console.log(`⚠️  Over 500 chars: ${overLimitCount}`);
  console.log(`✅ Generation Quality: ${overLimitCount === 0 ? 'EXCELLENT' : 'NEEDS REVIEW'}`);
}

// Extract text content from a Notion page
async function getEmailContent(pageId) {
  try {
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
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

    if (!content.trim()) {
      throw new Error('No content found in the email page');
    }

    return content.trim();
  } catch (error) {
    console.error('❌ Error extracting email content:', error);
    throw new Error(`Failed to extract email content: ${error.message}`);
  }
}

// Get the content creation prompt from Notion
async function getPromptFromNotion() {
  try {
    const promptPageId = process.env.PROMPT_PAGE_ID;
    
    if (!promptPageId) {
      console.log('⚠️ No PROMPT_PAGE_ID found, using simplified fallback prompt');
      return getSimplifiedPrompt();
    }

    const blocks = await notion.blocks.children.list({
      block_id: promptPageId,
      page_size: 100
    });

    let promptContent = '';
    
    for (const block of blocks.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text) {
        const text = block.paragraph.rich_text.map(rt => rt.plain_text).join('');
        promptContent += text + '\n';
      } else if (block.type === 'heading_1' && block.heading_1.rich_text) {
        const text = block.heading_1.rich_text.map(rt => rt.plain_text).join('');
        promptContent += '\n# ' + text + '\n';
      } else if (block.type === 'heading_2' && block.heading_2.rich_text) {
        const text = block.heading_2.rich_text.map(rt => rt.plain_text).join('');
        promptContent += '\n## ' + text + '\n';
      } else if (block.type === 'heading_3' && block.heading_3.rich_text) {
        const text = block.heading_3.rich_text.map(rt => rt.plain_text).join('');
        promptContent += '\n### ' + text + '\n';
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text) {
        const text = block.bulleted_list_item.rich_text.map(rt => rt.plain_text).join('');
        promptContent += '- ' + text + '\n';
      } else if (block.type === 'numbered_list_item' && block.numbered_list_item.rich_text) {
        const text = block.numbered_list_item.rich_text.map(rt => rt.plain_text).join('');
        promptContent += text + '\n';
      } else if (block.type === 'code' && block.code.rich_text) {
        const text = block.code.rich_text.map(rt => rt.plain_text).join('');
        promptContent += '```\n' + text + '\n```\n';
      }
    }

    if (!promptContent.trim()) {
      console.log('⚠️ Empty prompt content from Notion, using fallback');
      return getSimplifiedPrompt();
    }

    console.log(`✅ Retrieved ${promptContent.length} characters of prompt content from Notion`);
    return promptContent.trim();
    
  } catch (error) {
    console.error('❌ Error getting prompt from Notion:', error);
    console.log('🔄 Using simplified fallback prompt due to error');
    return getSimplifiedPrompt();
  }
}

// Simplified fallback prompt
function getSimplifiedPrompt() {
  return `
Transform this email content into high-quality, engaging tweets that capture the key insights and value.

REQUIREMENTS:
1. Create 2-3 tweet concepts maximum
2. Each tweet should have a clear hook, insight, and value
3. Keep posts under 500 characters each
4. Include character counts for each post
5. Add a compelling CTA tweet for each concept
6. Make sure each tweet is self-contained and valuable

Return in this JSON format:
{
  "tweetConcepts": [
    {
      "concept": "Brief description of the concept",
      "strategy": "Content strategy used",
      "mainContent": {
        "posts": ["Tweet text here"],
        "characterCounts": ["150/500 ✅"]
      },
      "cta": "Call to action tweet text"
    }
  ]
}
`;
}

// Create Notion pages with complete structure including all elements
async function createFullStructurePages(tweetsData, emailPageId) {
  try {
    console.log('\n📄 === CREATING NOTION PAGES WITH FULL STRUCTURE ===');
    
    if (!tweetsData.tweetConcepts || tweetsData.tweetConcepts.length === 0) {
      throw new Error('No tweet concepts found in the generated data');
    }

    const results = [];

    for (let i = 0; i < tweetsData.tweetConcepts.length; i++) {
      const concept = tweetsData.tweetConcepts[i];
      
      console.log(`\n🏗️ Creating page ${i + 1}/${tweetsData.tweetConcepts.length}`);
      console.log(`   Concept: ${concept.concept}`);
      console.log(`   Posts: ${concept.mainContent.posts.length}`);
      console.log(`   Strategy: ${concept.strategy}`);

      // Build blocks array for the page content
      const blocks = [];
      
      // Title and concept overview
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: concept.concept }
          }]
        }
      });
      
      // Strategy section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Strategy:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: concept.strategy }
          }]
        }
      });
      
      // Main Content section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Tweet Content:' }
          }]
        }
      });
      
      // Add each post with character counts
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
  console.log(`🔧 Version: 16.0 - Skills API Only`);
  console.log(`📝 Using prompt from Notion page: ${process.env.PROMPT_PAGE_ID || 'Simplified fallback'}`);
  console.log(`🔗 Newsletter link: ${process.env.NEWSLETTER_LINK || 'Not set'}`);
  console.log(`🎯 Generation Mode: Skills API Only (no fallbacks)`);
  console.log(`📦 Skill ID: ${process.env.CONTENT_TO_TWEETS_SKILL_ID || 'skill_01SALXgCNgsvghBCYiczfhWW'}`);
});
