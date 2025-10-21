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
    version: '13.1 - API Fixed (Solutions A+I)',
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

    // Step 5: Generate tweets using enhanced API approach (Solutions A+I)
    console.log('🤖 Step 5: Generating tweets with enhanced quality approach...');
    const tweetsData = await generateTweetsWithEnhancedQuality(emailContent, prompt);
    console.log(`✅ Generated ${tweetsData.tweetConcepts.length} tweet concepts`);

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
        content += '- ' + text + '\n';
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

    return content.trim();
  } catch (error) {
    console.error('❌ Error extracting email content:', error);
    throw new Error(`Failed to extract email content: ${error.message}`);
  }
}

// Get prompt from Notion page or use default
async function getPromptFromNotion() {
  try {
    if (!process.env.PROMPT_PAGE_ID) {
      console.log('ℹ️ No PROMPT_PAGE_ID set, using simplified default prompt');
      return getDefaultPrompt();
    }

    console.log(`📄 Fetching prompt from Notion page: ${process.env.PROMPT_PAGE_ID}`);
    
    const response = await notion.blocks.children.list({
      block_id: process.env.PROMPT_PAGE_ID,
      page_size: 100
    });

    let prompt = '';
    
    for (const block of response.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        const text = block.paragraph.rich_text.map(text => text.plain_text).join('');
        prompt += text + '\n\n';
      } 
      else if (block.type === 'heading_1' && block.heading_1.rich_text.length > 0) {
        const text = block.heading_1.rich_text.map(text => text.plain_text).join('');
        prompt += '# ' + text + '\n\n';
      }
      else if (block.type === 'heading_2' && block.heading_2.rich_text.length > 0) {
        const text = block.heading_2.rich_text.map(text => text.plain_text).join('');
        prompt += '## ' + text + '\n\n';
      }
      else if (block.type === 'heading_3' && block.heading_3.rich_text.length > 0) {
        const text = block.heading_3.rich_text.map(text => text.plain_text).join('');
        prompt += '### ' + text + '\n\n';
      }
      else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text.length > 0) {
        const text = block.bulleted_list_item.rich_text.map(text => text.plain_text).join('');
        prompt += '- ' + text + '\n';
      }
      else if (block.type === 'numbered_list_item' && block.numbered_list_item.rich_text.length > 0) {
        const text = block.numbered_list_item.rich_text.map(text => text.plain_text).join('');
        prompt += '1. ' + text + '\n';
      }
      else if (block.type === 'quote' && block.quote.rich_text.length > 0) {
        const text = block.quote.rich_text.map(text => text.plain_text).join('');
        prompt += '> ' + text + '\n\n';
      }
      else if (block.type === 'code' && block.code.rich_text.length > 0) {
        const text = block.code.rich_text.map(text => text.plain_text).join('');
        prompt += '```\n' + text + '\n```\n\n';
      }
    }

    if (!prompt.trim()) {
      console.log('⚠️ Notion prompt page was empty, using default prompt');
      return getDefaultPrompt();
    }

    console.log(`✅ Successfully loaded ${prompt.length} characters of prompt from Notion`);
    return prompt.trim();

  } catch (error) {
    console.error('❌ Error fetching prompt from Notion:', error);
    console.log('ℹ️ Falling back to default prompt');
    return getDefaultPrompt();
  }
}

// Fallback prompt if Notion page unavailable
function getDefaultPrompt() {
  return `You are a content extraction specialist for the 2 Hour Man brand. Transform the provided content into 5 high-quality tweet concepts following these requirements:

1. Each tweet must be under 500 characters
2. If content exceeds 500 characters, split into multiple posts
3. Include What-Why-Where cycle analysis (internal use only)
4. Generate one CTA tweet per concept
5. Focus on actionable insights from the source content

Output must be valid JSON with this structure:
{
  "tweetConcepts": [
    {
      "number": 1,
      "title": "Brief Description",
      "mainContent": {
        "posts": ["Tweet content under 500 chars"],
        "characterCounts": ["X/500 ✅"]
      },
      "ahamoment": "Key insight",
      "cta": "CTA tweet under 500 chars",
      "qualityValidation": "Brief validation"
    }
  ]
}`;
}

// SOLUTION A + I: Enhanced API call with CORRECTED system parameter structure
async function generateTweetsWithEnhancedQuality(emailContent, prompt) {
  try {
    console.log('🤖 Calling Claude API with enhanced quality approach (Solutions A+I)...');
    
    // SOLUTION A: System message as top-level parameter (CORRECTED FORMAT)
    const systemMessage = `You are an expert content strategist and copywriter specializing in high-converting social media content. You have deep expertise in psychological triggers, audience psychology, and content that drives real engagement and conversions. Your writing is strategic, insightful, and creates genuine value for readers.

You excel at:
- Extracting core insights from long-form content
- Creating psychological hooks that capture attention
- Building compelling narratives that drive action
- Crafting CTAs that create genuine curiosity gaps
- Using specific examples and concrete details
- Explaining mechanisms, not just naming concepts`;

    // SOLUTION I: Interactive conversation flow
    const messages = [
      {
        role: 'user',
        content: prompt
      },
      {
        role: 'assistant',
        content: `I understand. I'm ready to transform content into high-quality tweet concepts following your complete methodology. I'll focus on creating content that feels authentic, strategic, and conversion-focused - the same quality you'd expect from our best manual work.

Let me know what content you'd like me to analyze and transform.`
      },
      {
        role: 'user', 
        content: `Perfect! Let's work on this together. I'll share the email content, and you'll create strategic tweet concepts using your expertise.

Here's the content to analyze and transform:

${emailContent}

Please create 5 high-quality tweet concepts following the complete methodology. Focus on quality and strategic impact first, then format as clean JSON structure.`
      }
    ];

    // CORRECTED API CALL: system as top-level parameter, NOT in messages array
    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME,
      max_tokens: 6000, // Increased for more detailed responses
      temperature: 0.85, // Higher creativity for better content
      top_p: 0.9, // Better sampling
      system: systemMessage, // ✅ CORRECT - system as top-level parameter
      messages: messages // ✅ CORRECT - no system role in messages array
    });

    console.log('✅ Claude API call completed');
    
    const responseText = response.content[0].text;
    console.log(`📝 Raw response length: ${responseText.length} characters`);

    try {
      // Strip markdown code blocks if Claude wrapped the JSON
      let cleanedResponse = responseText.trim();
      
      // Remove opening ```json or ``` 
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.substring(7); // Remove ```json
      } else if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.substring(3); // Remove ```
      }
      
      // Remove closing ```
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3); // Remove trailing ```
      }
      
      // Clean up any extra whitespace
      cleanedResponse = cleanedResponse.trim();
      
      console.log(`🧹 Cleaned response length: ${cleanedResponse.length} characters`);
      
      const parsedResponse = JSON.parse(cleanedResponse);
      console.log(`✅ Successfully parsed JSON response`);
      console.log(`📊 Generated ${parsedResponse.tweetConcepts.length} tweet concepts`);
      
      // Validate structure
      if (!parsedResponse.tweetConcepts || !Array.isArray(parsedResponse.tweetConcepts)) {
        throw new Error('Invalid JSON structure: missing tweetConcepts array');
      }
      
      // Auto-replace [newsletter link] or [link] with actual newsletter link
      const newsletterLink = process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/';
      
      parsedResponse.tweetConcepts.forEach((concept, index) => {
        if (concept.cta) {
          concept.cta = concept.cta.replace(/\[newsletter link\]/g, newsletterLink);
          concept.cta = concept.cta.replace(/\[link\]/g, newsletterLink);
        }
        
        console.log(`\n🔍 Concept ${index + 1}:`);
        console.log(`   Title: ${concept.title}`);
        console.log(`   Posts: ${concept.mainContent.posts.length}`);
        console.log(`   CTA length: ${concept.cta.length} characters`);
      });
      
      return parsedResponse;
      
    } catch (parseError) {
      console.error('❌ Failed to parse Claude response as JSON:', parseError);
      console.log('📝 Raw response for debugging:', responseText.substring(0, 500) + '...');
      
      // Try one more cleanup attempt
      try {
        // More aggressive cleanup
        let lastAttempt = responseText
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();
        
        // Find the first { and last }
        const firstBrace = lastAttempt.indexOf('{');
        const lastBrace = lastAttempt.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          lastAttempt = lastAttempt.substring(firstBrace, lastBrace + 1);
          console.log(`🔧 Attempting aggressive cleanup...`);
          
          // Apply newsletter link replacement before parsing
          const newsletterLink = process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/';
          lastAttempt = lastAttempt.replace(/\[newsletter link\]/g, newsletterLink);
          lastAttempt = lastAttempt.replace(/\[link\]/g, newsletterLink);
          
          const finalParsed = JSON.parse(lastAttempt);
          console.log(`✅ Aggressive cleanup successful!`);
          return finalParsed;
        }
      } catch (finalError) {
        console.error('❌ Final cleanup attempt failed:', finalError);
      }
      
      throw new Error(`Invalid JSON response from Claude: ${parseError.message}`);
    }

  } catch (error) {
    console.error('❌ Error generating tweets with Claude:', error);
    throw new Error(`Failed to generate tweets: ${error.message}`);
  }
}

// Create full structure pages in Notion with proper splitting and dividers - REMOVED What-Why-Where display
async function createFullStructurePages(tweetsData, emailPageId) {
  try {
    console.log(`\n📝 Creating ${tweetsData.tweetConcepts.length} full structure pages...`);
    
    const results = [];

    for (let i = 0; i < tweetsData.tweetConcepts.length; i++) {
      const concept = tweetsData.tweetConcepts[i];
      console.log(`\n🔨 Creating page ${i + 1}/${tweetsData.tweetConcepts.length}`);
      console.log(`   Concept: ${concept.title}`);
      console.log(`   Posts: ${concept.mainContent.posts.length}`);
      
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
      
      // REMOVED: What-Why-Where Cycle Check section (as requested)
      // This section has been completely removed from Notion display
      
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
  console.log(`🔧 Version: 13.1 - API Fixed (Solutions A+I)`);
  console.log(`📝 Using prompt from Notion page: ${process.env.PROMPT_PAGE_ID || 'Simplified fallback'}`);
  console.log(`🔗 Newsletter link: ${process.env.NEWSLETTER_LINK || 'Not set'}`);
});
