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
    version: '11.3 - Fixed Tweet Structure & CTA Links',
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
    console.log('📝 Step 4: Getting 2HourMan tweet prompt from Notion...');
    const prompt = await getPromptFromNotion();
    console.log('✅ 2HourMan tweet prompt retrieved from Notion');

    // Step 5: Generate tweets using enhanced structure
    console.log('🤖 Step 5: Generating tweet concepts with enhanced structure...');
    const tweetsData = await generateTweetsWithFullStructure(emailContent, prompt);
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
    console.log(`🔍 Reading 2HourMan prompt from Notion page ID: ${process.env.PROMPT_PAGE_ID}`);
    
    if (!process.env.PROMPT_PAGE_ID) {
      console.log('⚠️ No PROMPT_PAGE_ID set, using simplified fallback prompt');
      return getSimplifiedPromptWithCTA();
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
      return getSimplifiedPromptWithCTA();
    }

    console.log(`✅ Successfully extracted ${finalPrompt.length} characters from Notion prompt page`);
    console.log(`📝 Prompt preview: ${finalPrompt.substring(0, 200)}...`);
    
    return finalPrompt;

  } catch (error) {
    console.error('❌ Error fetching prompt from Notion:', error);
    console.log('🔄 Falling back to simplified prompt');
    return getSimplifiedPromptWithCTA();
  }
}

// Enhanced fallback prompt with CTA guidelines
function getSimplifiedPromptWithCTA() {
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

4. CTA REQUIREMENTS:
   - Must be UNIQUE to the specific content just written
   - Must reference the exact concept/aha moment from the tweet
   - Must promise only what's actually in the source content
   - Must end with the newsletter link - NO TEXT AFTER THE LINK
   - Bridge naturally from the specific insight provided

Create 3-5 tweet concepts. For each, provide complete structure including CTA.`;
}

// ENHANCED: Generate tweets with better structure enforcement
async function generateTweetsWithFullStructure(emailContent, prompt) {
  try {
    // ENHANCED: More explicit instructions for Claude
    const enhancedPrompt = `${prompt}

=== CRITICAL INSTRUCTIONS ===

You MUST follow the 2HourMan methodology exactly. Do NOT create a "fallback" or generic analysis.

REQUIRED OUTPUT FORMAT:
For each tweet concept, you MUST provide:

TWEET #1: [Specific concept title - NOT "Fallback Concept"]

Main Content:
[Actual tweet content here - write real tweets, not analysis]

Single Aha Moment:
[The ONE specific insight this tweet provides]

What-Why-Where Cycle Check:
✅ WHAT: [How the concept is defined in the tweet]
✅ WHY: [Why this matters - the mechanism/importance shown]
✅ WHERE: [What action the reader should take]

Character Counts:
- Post 1: [X]/500 ✅

---

CTA Tweet:
[Specific CTA that bridges from this tweet's insight ending with the newsletter link]

Character Count:
- CTA: [X]/500 ✅

---

REPEAT for TWEET #2, TWEET #3, etc.

=== END CRITICAL INSTRUCTIONS ===

SOURCE CONTENT TO ANALYZE:
${emailContent}

NEWSLETTER LINK TO USE IN ALL CTAS: ${process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/'}

Now create 3-5 actual tweet concepts (not analysis) following this exact format.`;

    console.log('\n📤 SENDING ENHANCED STRUCTURE REQUEST:');
    console.log('Enhanced prompt length:', enhancedPrompt.length);
    console.log('Newsletter link being enforced:', process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/');

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME,
      max_tokens: 8000,
      messages: [{ role: 'user', content: enhancedPrompt }]
    });

    const content = response.content[0].text;
    
    console.log('\n📥 CLAUDE RESPONSE:');
    console.log('Response length:', content.length);
    console.log('First 800 characters:', content.substring(0, 800));
    
    // ENHANCED: More robust parsing
    const tweetConcepts = parseEnhancedStructuredResponse(content);
    
    // FORCE newsletter link in all CTAs
    tweetConcepts.forEach((concept, index) => {
      concept.cta = forceCorrectNewsletterLink(concept.cta);
      console.log(`✅ Fixed CTA for concept ${index + 1}: ${concept.cta.substring(0, 100)}...`);
    });
    
    console.log(`✅ Successfully parsed ${tweetConcepts.length} tweet concepts`);
    
    return { tweetConcepts };

  } catch (error) {
    console.error('❌ Error generating tweets:', error);
    
    // Better fallback with proper structure
    return {
      tweetConcepts: [{
        number: 1,
        title: 'AI Business Efficiency Tweet',
        mainContent: {
          posts: ['Most business owners are drowning in busy work while AI could compress their operations from 8 hours to 2 focused hours. The competitive advantage isn\'t avoiding AI—it\'s mastering operational leverage.'],
          characterCounts: [203]
        },
        ahamoment: 'AI amplifies expertise rather than replacing it',
        whatWhyWhere: {
          what: 'AI as operational compression tool',
          why: 'Creates competitive advantage through efficiency',
          where: 'Focus on systems and leverage, not just tasks'
        },
        cta: `Understanding operational leverage is one thing. Having the systems that actually compress your workday is different. Get the complete framework: ${process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/'}`,
        qualityValidation: 'Fallback concept - manual review needed'
      }]
    };
  }
}

// ENHANCED: Better parsing that handles various Claude response formats
function parseEnhancedStructuredResponse(content) {
  const tweetConcepts = [];
  
  try {
    console.log('\n🔍 ENHANCED PARSING:');
    
    // Strategy 1: Look for numbered tweets
    const tweetMatches = content.match(/TWEET\s*#\d+:[\s\S]*?(?=TWEET\s*#\d+:|$)/gi);
    
    if (tweetMatches && tweetMatches.length > 0) {
      console.log(`✅ Found ${tweetMatches.length} structured tweets`);
      
      tweetMatches.forEach((match, index) => {
        const concept = parseIndividualTweetConcept(match, index + 1);
        if (concept) {
          tweetConcepts.push(concept);
        }
      });
    } else {
      console.log('⚠️ No TWEET # pattern found, trying alternative parsing...');
      
      // Strategy 2: Look for any structured content
      const lines = content.split('\n').filter(line => line.trim().length > 10);
      
      if (lines.length > 5) {
        // Find content that looks like tweets
        const tweetLikeLines = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 50 && 
                 trimmed.length < 500 && 
                 !trimmed.startsWith('#') &&
                 !trimmed.startsWith('✅') &&
                 !trimmed.includes('Character Count:');
        });
        
        if (tweetLikeLines.length > 0) {
          console.log(`📄 Found ${tweetLikeLines.length} tweet-like content lines`);
          
          // Create concepts from tweet-like content
          tweetLikeLines.slice(0, 3).forEach((line, index) => {
            tweetConcepts.push({
              number: index + 1,
              title: `Tweet Concept ${index + 1}`,
              mainContent: {
                posts: [line.trim()],
                characterCounts: [line.trim().length]
              },
              ahamoment: `Key insight from concept ${index + 1}`,
              whatWhyWhere: {
                what: 'Concept defined from content',
                why: 'Importance identified from context',
                where: 'Action derived from insight'
              },
              cta: `Get more insights like this: ${process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/'}`,
              qualityValidation: 'Parsed from unstructured content'
            });
          });
        }
      }
    }
    
    // If still no concepts, create one from the content
    if (tweetConcepts.length === 0) {
      console.log('🔧 Creating concept from raw content...');
      
      const shortContent = content.substring(0, 400).trim();
      tweetConcepts.push({
        number: 1,
        title: 'Extracted Concept',
        mainContent: {
          posts: [shortContent],
          characterCounts: [shortContent.length]
        },
        ahamoment: 'Insight extracted from response',
        whatWhyWhere: {
          what: 'Content analysis attempted',
          why: 'Structure not properly followed',
          where: 'Review prompt and response'
        },
        cta: `Get structured insights: ${process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/'}`,
        qualityValidation: 'Manual extraction required'
      });
    }
    
  } catch (error) {
    console.error('❌ Enhanced parsing failed:', error);
    
    // Final fallback
    tweetConcepts.push({
      number: 1,
      title: 'Parse Error Recovery',
      mainContent: {
        posts: ['Error in content processing. Manual review needed.'],
        characterCounts: [0]
      },
      ahamoment: 'System error occurred',
      whatWhyWhere: {
        what: 'Parsing system failed',
        why: 'Technical error in processing',
        where: 'Check logs and retry'
      },
      cta: `System error. Get reliable content: ${process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/'}`,
      qualityValidation: 'Error recovery needed'
    });
  }
  
  console.log(`📊 Enhanced parsing result: ${tweetConcepts.length} concepts created`);
  return tweetConcepts;
}

// Helper to parse individual tweet concepts
function parseIndividualTweetConcept(match, conceptNum) {
  try {
    // Extract title
    const titleMatch = match.match(/TWEET\s*#\d+:\s*([^\n]+)/i);
    const title = titleMatch ? titleMatch[1].trim() : `Tweet Concept ${conceptNum}`;
    
    // Skip if it's a fallback concept
    if (title.toLowerCase().includes('fallback')) {
      console.log(`⚠️ Skipping fallback concept ${conceptNum}`);
      return null;
    }
    
    // Extract main content
    const mainContentMatch = match.match(/Main Content:\s*([\s\S]*?)(?=Single Aha Moment:|$)/i);
    const mainContentText = mainContentMatch ? mainContentMatch[1].trim() : '';
    
    // Clean up main content (remove analysis markers)
    const cleanContent = cleanMainContent(mainContentText);
    
    if (cleanContent.length < 20) {
      console.log(`⚠️ Main content too short for concept ${conceptNum}`);
      return null;
    }
    
    // Extract other sections
    const ahaMatch = match.match(/Single Aha Moment:\s*([\s\S]*?)(?=What-Why-Where|$)/i);
    const ahamoment = ahaMatch ? ahaMatch[1].trim() : `Insight from concept ${conceptNum}`;
    
    const whatWhyWhereMatch = match.match(/What-Why-Where Check:\s*([\s\S]*?)(?=Character Count|CTA Tweet|$)/i);
    const whatWhyWhere = parseWhatWhyWhere(whatWhyWhereMatch ? whatWhyWhereMatch[1] : '');
    
    const ctaMatch = match.match(/CTA Tweet:\s*([\s\S]*?)(?=Character Count|$)/i);
    const cta = ctaMatch ? ctaMatch[1].trim() : `Get more insights: ${process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/'}`;
    
    return {
      number: conceptNum,
      title: title,
      mainContent: {
        posts: [cleanContent],
        characterCounts: [cleanContent.length]
      },
      ahamoment: ahamoment,
      whatWhyWhere: whatWhyWhere,
      cta: cta,
      qualityValidation: 'Parsed from structured response'
    };
    
  } catch (error) {
    console.error(`❌ Error parsing individual concept ${conceptNum}:`, error);
    return null;
  }
}

// Helper to clean main content (remove analysis text)
function cleanMainContent(content) {
  // Remove common analysis markers
  let cleaned = content
    .replace(/# Phase 1:.*$/gm, '')
    .replace(/## Core Message\/Theme.*$/gm, '')
    .replace(/## Key Insights.*$/gm, '')
    .replace(/- Free time.*$/gm, '')
    .replace(/- Information.*$/gm, '')
    .replace(/- High-retention.*$/gm, '')
    .replace(/- AI exe.*$/gm, '')
    .replace(/Character Count:.*$/gm, '')
    .replace(/^\s*-\s/gm, '')
    .replace(/^\s*\*\s/gm, '')
    .replace(/^\s*#+ /gm, '')
    .trim();
  
  // Extract the first substantial paragraph that looks like tweet content
  const lines = cleaned.split('\n').filter(line => line.trim().length > 20);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 50 && trimmed.length < 500 && 
        !trimmed.includes('analysis') && 
        !trimmed.includes('Phase') &&
        !trimmed.includes('##')) {
      return trimmed;
    }
  }
  
  // Fallback: use cleaned content
  return cleaned.substring(0, 400).trim();
}

// ENHANCED: Force correct newsletter link
function forceCorrectNewsletterLink(cta) {
  const correctLink = process.env.NEWSLETTER_LINK || 'https://go.thepeakperformer.io/';
  
  // Remove any existing links
  let cleanCTA = cta.replace(/https?:\/\/[^\s]+/g, '').trim();
  
  // Remove trailing punctuation
  cleanCTA = cleanCTA.replace(/[.!?]*$/, '');
  
  // Add correct link
  return `${cleanCTA}: ${correctLink}`;
}

// Helper function to parse What-Why-Where analysis
function parseWhatWhyWhere(analysisText) {
  try {
    const whatMatch = analysisText.match(/✅\s*WHAT:\s*([^\n]+)/i);
    const whyMatch = analysisText.match(/✅\s*WHY:\s*([^\n]+)/i);
    const whereMatch = analysisText.match(/✅\s*WHERE:\s*([^\n]+)/i);
    
    return {
      what: whatMatch ? whatMatch[1].trim() : 'Concept needs clear definition',
      why: whyMatch ? whyMatch[1].trim() : 'Importance and mechanism to be identified',
      where: whereMatch ? whereMatch[1].trim() : 'Action steps to be specified'
    };
  } catch (error) {
    console.error('Error parsing What-Why-Where:', error);
    return {
      what: 'Definition needed',
      why: 'Importance unclear',
      where: 'Action required'
    };
  }
}

// Helper function to parse main content posts (handles splits)
function parseMainContentPosts(contentText) {
  try {
    // Look for "Post 1:", "Post 2:" pattern for split posts
    const postMatches = contentText.match(/Post\s+\d+:\s*([\s\S]*?)(?=Post\s+\d+:|$)/gi);
    
    if (postMatches && postMatches.length > 1) {
      // Multiple posts found
      return postMatches.map(match => {
        const postContent = match.replace(/Post\s+\d+:\s*/i, '').trim();
        return postContent;
      });
    } else {
      // Single post
      return [contentText];
    }
  } catch (error) {
    console.error('Error parsing main content posts:', error);
    return [contentText];
  }
}

// Helper function to parse character counts
function parseCharacterCounts(countText, expectedPosts) {
  try {
    const countMatches = countText.match(/(\d+)\/500/g);
    
    if (countMatches && countMatches.length > 0) {
      return countMatches.map(match => {
        const count = match.match(/(\d+)/)[1];
        return parseInt(count);
      });
    } else {
      // Fallback: create default counts
      return Array(expectedPosts).fill(0);
    }
  } catch (error) {
    console.error('Error parsing character counts:', error);
    return Array(expectedPosts).fill(0);
  }
}

// Create pages following the complete 2HourMan structure
async function createFullStructurePages(tweetsData, emailPageId) {
  try {
    const results = [];

    console.log('\n📝 CREATING FULL STRUCTURE PAGES:');
    console.log(`Processing ${tweetsData.tweetConcepts.length} tweet concepts...`);

    for (let i = 0; i < tweetsData.tweetConcepts.length; i++) {
      const concept = tweetsData.tweetConcepts[i];
      
      console.log(`\n🧵 CREATING PAGE FOR CONCEPT ${i + 1}:`);
      console.log(`Title: ${concept.title}`);
      console.log(`Posts: ${concept.mainContent.posts.length}`);
      console.log(`CTA: ${concept.cta.substring(0, 50)}...`);

      // Create blocks following the exact 2HourMan format
      const blocks = [];
      
      // TWEET #X: Title
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: `TWEET #${concept.number}: ${concept.title}` }
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
            text: { content: 'Main Content:' }
          }]
        }
      });
      
      // Add each post
      concept.mainContent.posts.forEach((post, postIndex) => {
        if (concept.mainContent.posts.length > 1) {
          // Multiple posts - add post header
          blocks.push({
            object: 'block',
            type: 'heading_3',
            heading_3: {
              rich_text: [{
                type: 'text',
                text: { content: `Post ${postIndex + 1}:` }
              }]
            }
          });
        }
        
        // Post content
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: post },
              annotations: { bold: true }
            }]
          }
        });
        
        // Character count for this post
        const charCount = concept.mainContent.characterCounts[postIndex] || post.length;
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: `Character Count: ${charCount}/500 ${charCount <= 500 ? '✅' : '❌'}` }
            }]
          }
        });
        
        // Add divider between posts
        if (postIndex < concept.mainContent.posts.length - 1) {
          blocks.push({
            object: 'block',
            type: 'divider',
            divider: {}
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
      
      // What-Why-Where Cycle Check section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'What-Why-Where Cycle Check:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: '✅ WHAT: ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: concept.whatWhyWhere.what }
            }
          ]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: '✅ WHY: ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: concept.whatWhyWhere.why }
            }
          ]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: '✅ WHERE: ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: concept.whatWhyWhere.where }
            }
          ]
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
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: `CTA Character Count: ${concept.cta.length}/500 ${concept.cta.length <= 500 ? '✅' : '❌'}` }
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

        console.log(`✅ Successfully created full structure page ${i + 1}: ${response.id}`);
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
                  text: { content: `Error creating full structure page for concept ${i + 1}. Check logs for details.\n\nOriginal content:\n${concept.mainContent.posts.join('\n\n')}\n\nCTA: ${concept.cta}` }
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

    console.log(`\n✅ COMPLETED: Created ${results.length} full structure pages`);
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
  console.log(`🔧 Version: 11.3 - Fixed Tweet Structure & CTA Links`);
  console.log(`📝 Using prompt from Notion page: ${process.env.PROMPT_PAGE_ID || 'Simplified fallback'}`);
  console.log(`🔗 Newsletter link: ${process.env.NEWSLETTER_LINK || 'Not set'}`);
});
