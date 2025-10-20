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
    version: '11.2 - Enhanced CTA with Newsletter Link',
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

    // Step 5: Generate tweets using full 2HourMan structure with enhanced CTAs
    console.log('🤖 Step 5: Generating tweet concepts with enhanced CTAs...');
    const tweetsData = await generateTweetsWithFullStructure(emailContent, prompt);
    console.log(`✅ Generated ${tweetsData.tweetConcepts.length} tweet concepts with customized CTAs`);

    // Step 6: Create pages with complete 2HourMan structure
    console.log('📝 Step 6: Creating full structure pages with enhanced CTAs...');
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

// ENHANCED: Get prompt from Notion page with CTA support
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

// ENHANCED: Generate tweets with full structure and customized CTAs
async function generateTweetsWithFullStructure(emailContent, prompt) {
  try {
    // Extract CTA customization from your brand/newsletter info
    const ctaCustomization = `
CTA CUSTOMIZATION FOR 2HOURMAN:
- Brand: 2 Hour Man (focus on efficiency and operational leverage)
- Newsletter: Productivity and business automation insights
- Target Audience: Business owners and entrepreneurs
- Value Proposition: Compress operations, build systems, gain competitive advantage
- Newsletter Link: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

CTA MUST:
1. Reference the SPECIFIC concept from the tweet (not generic)
2. Bridge from the exact insight/aha moment provided
3. Promise only what the newsletter actually covers
4. End with the newsletter link - nothing after it
5. Feel like the natural next step for THIS specific insight
6. Use 2HourMan voice (efficiency-focused, systems-thinking)

CTA EXAMPLES (customize for each specific concept):
- "Understanding [specific concept] is one thing. Having a system that [specific application] is different. Get the complete framework: [NEWSLETTER_LINK]"
- "If you're tired of [specific pain point from tweet], see how [specific solution approach]: [NEWSLETTER_LINK]"
- "Most people know about [concept] but can't [specific implementation challenge]. Here's the system that actually works: [NEWSLETTER_LINK]"
`;

    const fullPrompt = `${prompt}

${ctaCustomization}

SOURCE CONTENT TO ANALYZE:
${emailContent}

Please follow the 2HourMan methodology exactly as outlined above. For each tweet concept:

1. Apply Phase 1: Content Analysis to identify 3-5 distinct tweet concepts
2. For each concept, follow Phase 2: Sequential Tweet Development
3. Create CTAs that are UNIQUE to each specific concept using the guidelines above
4. Use the exact output format specified in the prompt

CRITICAL FOR CTA GENERATION:
- Each CTA must reference the SPECIFIC concept/insight from that tweet
- Must end with: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}
- NO text after the link
- Promise only what your newsletter actually delivers
- Bridge naturally from the specific insight provided

Provide the complete structured analysis for each tweet concept, including customized CTAs.`;

    console.log('\n📤 SENDING FULL STRUCTURE REQUEST WITH CTA CUSTOMIZATION:');
    console.log('Full prompt length:', fullPrompt.length);
    console.log('Newsletter link being used:', process.env.NEWSLETTER_LINK || 'https://your-newsletter.com');

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME,
      max_tokens: 8000,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    
    console.log('\n📥 CLAUDE RESPONSE WITH CUSTOMIZED CTAS:');
    console.log('Response length:', content.length);
    console.log('First 500 characters:', content.substring(0, 500));
    
    // Parse the full structured response
    const tweetConcepts = parseFullStructuredResponse(content);
    
    // Post-process CTAs to ensure newsletter link is included
    tweetConcepts.forEach((concept, index) => {
      concept.cta = ensureNewsletterLinkInCTA(concept.cta);
      console.log(`✅ Processed CTA for concept ${index + 1}: ${concept.cta.substring(0, 100)}...`);
    });
    
    console.log(`✅ Successfully parsed ${tweetConcepts.length} tweet concepts with customized CTAs`);
    
    return { tweetConcepts };

  } catch (error) {
    console.error('❌ Error generating tweets with customized CTAs:', error);
    
    // Fallback response
    return {
      tweetConcepts: [{
        number: 1,
        title: 'Error in Tweet Generation',
        mainContent: {
          posts: [`Error generating tweets: ${error.message}`],
          characterCounts: [0]
        },
        ahamoment: 'Error occurred during tweet generation',
        whatWhyWhere: {
          what: 'Error in processing',
          why: 'System encountered an error',
          where: 'Check logs for details'
        },
        cta: `Error generating content. Get reliable automation insights: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}`,
        qualityValidation: 'Error - validation not completed'
      }]
    };
  }
}

// Helper function to ensure newsletter link is properly included in CTA
function ensureNewsletterLinkInCTA(cta) {
  try {
    const newsletterLink = process.env.NEWSLETTER_LINK || 'https://your-newsletter.com';
    
    // Check if the CTA already has a proper link at the end
    if (cta.endsWith(newsletterLink)) {
      console.log('✅ CTA already has correct newsletter link at end');
      return cta;
    }
    
    // Check if CTA has any link placeholder that needs to be replaced
    if (cta.includes('[NEWSLETTER_LINK]')) {
      const updatedCTA = cta.replace('[NEWSLETTER_LINK]', newsletterLink);
      console.log('✅ Replaced [NEWSLETTER_LINK] placeholder with actual link');
      return updatedCTA;
    }
    
    if (cta.includes('[link]')) {
      const updatedCTA = cta.replace('[link]', newsletterLink);
      console.log('✅ Replaced [link] placeholder with newsletter link');
      return updatedCTA;
    }
    
    // If no link found, append it properly
    if (!cta.includes('http')) {
      // Remove any trailing punctuation and add the link
      const cleanCTA = cta.replace(/[.!?]*$/, '');
      const finalCTA = `${cleanCTA}: ${newsletterLink}`;
      console.log('✅ Added newsletter link to CTA that was missing it');
      return finalCTA;
    }
    
    // If it has some other link, replace with newsletter link
    const linkPattern = /(https?:\/\/[^\s]+)/g;
    if (cta.match(linkPattern)) {
      const updatedCTA = cta.replace(linkPattern, newsletterLink);
      console.log('✅ Replaced existing link with newsletter link');
      return updatedCTA;
    }
    
    return cta;
    
  } catch (error) {
    console.error('❌ Error processing CTA link:', error);
    // Fallback: append newsletter link
    return `${cta}\n\nGet more insights: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}`;
  }
}

// ENHANCED: Parse full structured response with CTA focus
function parseFullStructuredResponse(content) {
  const tweetConcepts = [];
  
  try {
    console.log('\n🔍 PARSING FULL STRUCTURED RESPONSE WITH CTA FOCUS:');
    
    // Look for "TWEET #X:" pattern to identify concepts
    const conceptMatches = content.match(/TWEET\s*#\d+:[\s\S]*?(?=TWEET\s*#\d+:|$)/gi);
    
    if (conceptMatches && conceptMatches.length > 0) {
      console.log(`✅ Found ${conceptMatches.length} tweet concepts`);
      
      conceptMatches.forEach((match, index) => {
        try {
          const conceptNum = index + 1;
          console.log(`\n📋 Parsing concept ${conceptNum}...`);
          
          // Extract title/description
          const titleMatch = match.match(/TWEET\s*#\d+:\s*([^\n]+)/i);
          const title = titleMatch ? titleMatch[1].trim() : `Tweet Concept ${conceptNum}`;
          
          // Extract main content (could be multiple posts)
          const mainContentMatch = match.match(/Main Content:\s*([\s\S]*?)(?=\n\nSingle Aha Moment:|Single Aha Moment:|$)/i);
          const mainContentText = mainContentMatch ? mainContentMatch[1].trim() : 'Content extraction failed';
          
          // Parse main content for multiple posts
          const posts = parseMainContentPosts(mainContentText);
          
          // Extract aha moment
          const ahaMatch = match.match(/Single Aha Moment:\s*([\s\S]*?)(?=\n\nWhat-Why-Where|What-Why-Where|$)/i);
          const ahamoment = ahaMatch ? ahaMatch[1].trim() : 'Aha moment not identified';
          
          // Extract What-Why-Where analysis
          const whatWhyWhereMatch = match.match(/What-Why-Where Check:\s*([\s\S]*?)(?=\n\nCharacter Count|Character Count|$)/i);
          const whatWhyWhere = parseWhatWhyWhere(whatWhyWhereMatch ? whatWhyWhereMatch[1] : '');
          
          // Extract character counts
          const charCountMatch = match.match(/Character Count[s]?:\s*([\s\S]*?)(?=\n\n---|CTA Tweet:|$)/i);
          const characterCounts = parseCharacterCounts(charCountMatch ? charCountMatch[1] : '', posts.length);
          
          // Extract CTA tweet with enhanced parsing
          const ctaMatch = match.match(/CTA Tweet:\s*([\s\S]*?)(?=\n\nCTA Uniqueness|CTA Uniqueness|Character Count|Quality Validation|$)/i);
          let cta = ctaMatch ? ctaMatch[1].trim() : 'CTA not found';
          
          // Clean up CTA (remove extra formatting, ensure single line)
          cta = cta.replace(/\n+/g, ' ').trim();
          
          console.log(`📝 Extracted CTA: ${cta.substring(0, 100)}...`);
          
          // Extract quality validation
          const qualityMatch = match.match(/Quality Validation:\s*([\s\S]*?)(?=\n\n|$)/i);
          const qualityValidation = qualityMatch ? qualityMatch[1].trim() : 'Quality validation not found';
          
          const concept = {
            number: conceptNum,
            title: title,
            mainContent: {
              posts: posts,
              characterCounts: characterCounts
            },
            ahamoment: ahamoment,
            whatWhyWhere: whatWhyWhere,
            cta: cta,
            qualityValidation: qualityValidation
          };
          
          tweetConcepts.push(concept);
          console.log(`✅ Successfully parsed concept ${conceptNum}: "${title}"`);
          
        } catch (parseError) {
          console.error(`❌ Error parsing concept ${index + 1}:`, parseError);
          
          // Add error concept with fallback CTA
          tweetConcepts.push({
            number: index + 1,
            title: `Concept ${index + 1} - Parse Error`,
            mainContent: {
              posts: ['Failed to parse this concept from Claude response'],
              characterCounts: [0]
            },
            ahamoment: 'Parse error occurred',
            whatWhyWhere: {
              what: 'Unable to extract analysis',
              why: 'Parsing failed',
              where: 'Check logs for details'
            },
            cta: `Error parsing content. Get reliable automation insights: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}`,
            qualityValidation: 'Parse error - validation not completed'
          });
        }
      });
    } else {
      console.log('⚠️ No structured concepts found, creating fallback...');
      
      // Fallback: treat entire response as one concept
      tweetConcepts.push({
        number: 1,
        title: 'Fallback Concept',
        mainContent: {
          posts: [content.substring(0, 500).trim()],
          characterCounts: [content.substring(0, 500).length]
        },
        ahamoment: 'Unable to identify specific aha moment from response',
        whatWhyWhere: {
          what: 'Content analysis incomplete',
          why: 'Response format not recognized',
          where: 'Review Claude response structure'
        },
        cta: `Get proven systems for business efficiency: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}`,
        qualityValidation: 'Fallback concept - manual review needed'
      });
    }
    
  } catch (error) {
    console.error('❌ Complete parsing failure:', error);
    
    // Final fallback with working CTA
    tweetConcepts.push({
      number: 1,
      title: 'Parse Error',
      mainContent: {
        posts: ['Complete parsing failure occurred'],
        characterCounts: [0]
      },
      ahamoment: 'Parse error occurred',
      whatWhyWhere: {
        what: 'Parsing system failed',
        why: 'Unexpected response format',
        where: 'Check system logs'
      },
      cta: `System error occurred. Get reliable automation content: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}`,
      qualityValidation: 'Error - validation not completed'
    });
  }
  
  console.log(`📊 Final parsing result: ${tweetConcepts.length} concepts created with customized CTAs`);
  return tweetConcepts;
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

// Helper function to parse What-Why-Where analysis
function parseWhatWhyWhere(analysisText) {
  try {
    const whatMatch = analysisText.match(/✅\s*WHAT:\s*([^\n]+)/i);
    const whyMatch = analysisText.match(/✅\s*WHY:\s*([^\n]+)/i);
    const whereMatch = analysisText.match(/✅\s*WHERE:\s*([^\n]+)/i);
    
    return {
      what: whatMatch ? whatMatch[1].trim() : 'WHAT analysis not found',
      why: whyMatch ? whyMatch[1].trim() : 'WHY analysis not found',
      where: whereMatch ? whereMatch[1].trim() : 'WHERE analysis not found'
    };
  } catch (error) {
    console.error('Error parsing What-Why-Where:', error);
    return {
      what: 'Analysis parsing failed',
      why: 'Analysis parsing failed',
      where: 'Analysis parsing failed'
    };
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

// ENHANCED: Create pages following the complete 2HourMan structure
async function createFullStructurePages(tweetsData, emailPageId) {
  try {
    const results = [];

    console.log('\n📝 CREATING FULL STRUCTURE PAGES WITH ENHANCED CTAS:');
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

    console.log(`\n✅ COMPLETED: Created ${results.length} full structure pages with enhanced CTAs`);
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
  console.log(`🔧 Version: 11.2 - Enhanced CTA with Newsletter Link`);
  console.log(`📝 Using prompt from Notion page: ${process.env.PROMPT_PAGE_ID || 'Simplified fallback'}`);
  console.log(`🔗 Newsletter link: ${process.env.NEWSLETTER_LINK || 'Not set'}`);
});
