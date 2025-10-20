const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize clients
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Health check endpoint
app.get('/', (req, res) => {
  const config = {
    notionToken: process.env.NOTION_TOKEN ? '✅ Set' : '❌ Missing',
    anthropicKey: process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing',
    emailsDb: process.env.EMAILS_DATABASE_ID ? '✅ Set' : '❌ Missing',
    shortformDb: process.env.SHORTFORM_DATABASE_ID ? '✅ Set' : '❌ Missing',
    promptPage: process.env.PROMPT_PAGE_ID ? '✅ Set' : '❌ Missing',
    newsletterLink: process.env.NEWSLETTER_LINK ? '✅ Set' : '❌ Missing'
  };

  res.json({
    status: 'Email-to-Tweet Railway Server Running! 🚀',
    config: config,
    timestamp: new Date().toISOString(),
    version: '2.0 - Optimized for Notion Webhooks'
  });
});

// Main webhook endpoint - optimized for Notion's actual format
app.post('/webhook', async (req, res) => {
  try {
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('========================');
    
    // Get page_id from Notion's actual format
    let page_id = null;
    
    // Method 1: Direct page_id in body (custom setups)
    if (req.body.page_id) {
      page_id = req.body.page_id;
      console.log('✅ Found page_id in body.page_id:', page_id);
    }
    
    // Method 2: Notion's nested format - body.data.id (ACTUAL FORMAT!)
    else if (req.body.data && req.body.data.id) {
      page_id = req.body.data.id;
      console.log('✅ Found page_id in body.data.id:', page_id);
    }
    
    // Method 3: Notion's standard format - body.id (fallback)
    else if (req.body.id) {
      page_id = req.body.id;
      console.log('✅ Found page_id in body.id:', page_id);
    }
    
    // Method 3: Custom headers (fallback)
    else if (req.headers.page_id || req.headers['page-id']) {
      page_id = req.headers.page_id || req.headers['page-id'];
      console.log('✅ Found page_id in headers:', page_id);
    }
    
    // Method 4: URL parameters (fallback)
    else if (req.query.page_id) {
      page_id = req.query.page_id;
      console.log('✅ Found page_id in query params:', page_id);
    }
    
    if (!page_id) {
      console.log('❌ ERROR: No page_id found anywhere');
      console.log('Available body keys:', Object.keys(req.body));
      console.log('Available headers:', Object.keys(req.headers));
      console.log('Available query params:', Object.keys(req.query));
      return res.status(400).json({ 
        error: 'Missing page_id - tried body.page_id, body.id, headers, and query params',
        received_body: req.body,
        help: 'Make sure Notion button sends page ID in webhook'
      });
    }

    console.log(`🎯 Processing email page: ${page_id}`);

    // 1. Fetch email content from Notion PAGE CONTENT (blocks)
    console.log('📖 Step 1: Fetching email content...');
    const emailContent = await getEmailContent(page_id);
    console.log('✅ Email content fetched successfully');

    // 2. Get prompt from Notion page
    console.log('📝 Step 2: Fetching prompt...');
    const prompt = await getPromptFromNotion();
    console.log('✅ Prompt fetched successfully');

    // 3. Generate tweets with Claude
    console.log('🤖 Step 3: Generating tweets...');
    const tweets = await generateTweets(emailContent, prompt);
    console.log('✅ Tweets generated successfully');

    // 4. Create pages in Short Form database
    console.log('📄 Step 4: Creating short form pages...');
    const results = await createShortFormPages(tweets, page_id);
    console.log('✅ Short form pages created successfully');

    console.log(`🎉 SUCCESS: Created ${results.length} Twitter thread concepts`);

    res.json({
      success: true,
      message: `Created ${results.length} Twitter thread concepts`,
      email_page_id: page_id,
      threads_created: results.length,
      results: results
    });

  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    res.status(500).json({
      error: 'Failed to process email',
      details: error.message,
      email_page_id: page_id || 'unknown',
      timestamp: new Date().toISOString()
    });
  }
});

// Get email content from Notion page CONTENT (blocks, not properties)
async function getEmailContent(pageId) {
  try {
    console.log(`📖 Fetching page content for: ${pageId}`);
    
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100
    });

    console.log(`📄 Found ${response.results.length} blocks`);

    let content = '';
    for (const block of response.results) {
      // Handle different block types
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
      throw new Error('No content found in the email page. Make sure the page has text content (paragraphs, headings, lists, etc.)');
    }

    console.log(`✅ Extracted ${content.length} characters of content`);
    console.log(`📝 Content preview: ${content.substring(0, 200)}...`);
    return content.trim();
  } catch (error) {
    console.error('❌ Error fetching email content:', error);
    throw new Error(`Failed to fetch email content: ${error.message}`);
  }
}

// Get prompt from Notion page
async function getPromptFromNotion() {
  try {
    if (!process.env.PROMPT_PAGE_ID) {
      console.log('📝 Using fallback prompt (no PROMPT_PAGE_ID set)');
      return `You are an expert content creator who specializes in converting newsletters and emails into engaging Twitter threads.

Your task is to analyze the provided email content and create 5-7 different Twitter thread concepts.

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

// Generate tweets using Claude
async function generateTweets(emailContent, prompt) {
  try {
    console.log('🤖 Generating tweets with Claude...');
    
    const fullPrompt = `${prompt}

EMAIL CONTENT:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

Generate 5-7 Twitter thread concepts in JSON format. Each thread should be engaging and actionable.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    console.log(`🤖 Claude response length: ${content.length} characters`);
    
    try {
      // Extract JSON from Claude's response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`✅ Successfully parsed ${parsed.threads?.length || 0} thread concepts`);
        return parsed;
      } else {
        throw new Error('No JSON found in Claude response');
      }
    } catch (parseError) {
      console.log('⚠️ JSON parsing failed, using fallback format');
      console.log('Parse error:', parseError.message);
      // Fallback if JSON parsing fails
      return {
        threads: [{
          title: "Generated Twitter Content",
          tweets: [
            content.substring(0, 280),
            content.substring(280, 560) || "Check out our newsletter for more insights!",
            process.env.NEWSLETTER_LINK || "Subscribe for more content like this!"
          ]
        }]
      };
    }
  } catch (error) {
    console.error('❌ Error generating tweets:', error);
    throw new Error(`Failed to generate tweets: ${error.message}`);
  }
}

// Create pages in Short Form database
async function createShortFormPages(tweetsData, emailPageId) {
  try {
    console.log(`📝 Creating ${tweetsData.threads.length} short form pages...`);
    const results = [];

    for (let i = 0; i < tweetsData.threads.length; i++) {
      const thread = tweetsData.threads[i];
      const content = thread.tweets.join('\n\n---\n\n');
      
      console.log(`📄 Creating page ${i + 1}: ${thread.title}`);
      
      const response = await notion.pages.create({
        parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
        properties: {
          'Name': {
            title: [{ text: { content: thread.title } }]
          },
          'E-mails': {
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
        title: thread.title,
        url: response.url,
        tweet_count: thread.tweets.length
      });
      
      console.log(`✅ Created: ${thread.title} (${response.id})`);
    }

    console.log(`🎉 Successfully created ${results.length} pages in Short Form database`);
    return results;
  } catch (error) {
    console.error('❌ Error creating short form pages:', error);
    throw new Error(`Failed to create pages: ${error.message}`);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Email-to-Tweet server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}`);
  console.log(`🎯 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`🔧 Version: 2.0 - Optimized for Notion webhooks`);
  console.log(`📊 Enhanced logging enabled for debugging`);
});
