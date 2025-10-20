const express = require('express');
const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 8000;

// Initialize Notion and Anthropic clients
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'Email-to-Tweet Railway Server Running! 🚀',
    config: {
      notionToken: process.env.NOTION_TOKEN ? '✅ Set' : '❌ Missing',
      anthropicKey: process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing',
      emailsDb: process.env.EMAILS_DATABASE_ID ? '✅ Set' : '❌ Missing',
      shortformDb: process.env.SHORTFORM_DATABASE_ID ? '✅ Set' : '❌ Missing',
      promptPage: process.env.PROMPT_PAGE_ID ? '✅ Set' : '❌ Missing',
      newsletterLink: process.env.NEWSLETTER_LINK ? '✅ Set' : '❌ Missing'
    },
    timestamp: new Date().toISOString()
  });
});

// Webhook endpoint - handles BOTH verification and Integration webhooks
app.post('/webhook', async (req, res) => {
  try {
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('========================');

    // STEP 1: Handle Notion Integration Verification
    if (req.body.verification_token) {
      console.log('🔐 VERIFICATION TOKEN RECEIVED');
      console.log('Token:', req.body.verification_token);
      
      // Send success response for verification
      res.status(200).json({ 
        success: true, 
        message: 'Verification token received',
        timestamp: new Date().toISOString()
      });
      
      console.log('✅ Verification response sent');
      return;
    }

    // STEP 2: Handle Integration Webhook Events (page updates)
    if (req.body.object === 'event' && req.body.event) {
      console.log('📄 INTEGRATION WEBHOOK EVENT RECEIVED');
      
      const event = req.body.event;
      const pageId = event.id;
      const eventType = req.body.type;
      
      console.log('Event Type:', eventType);
      console.log('Page ID:', pageId);
      
      if (!pageId) {
        throw new Error('No page ID found in Integration webhook event');
      }

      // Process the email page
      console.log('🚀 Starting email processing...');
      
      // Get email content from the page
      console.log('📖 Fetching email content...');
      const emailContent = await getEmailContent(pageId);
      
      // Get prompt from Notion page
      console.log('📝 Fetching prompt...');
      const prompt = await getPromptFromNotion();
      
      // Generate tweets using Claude
      console.log('🤖 Generating tweets...');
      const tweetsData = await generateTweets(emailContent, prompt);
      
      // Create pages in Short Form database
      console.log('📄 Creating short form pages...');
      const results = await createShortFormPages(tweetsData, pageId);
      
      console.log('🎉 SUCCESS! Created', results.length, 'short form pages');
      
      res.status(200).json({
        success: true,
        message: `Successfully created ${results.length} short form pages`,
        pageId: pageId,
        results: results,
        timestamp: new Date().toISOString()
      });
      
      return;
    }

    // STEP 3: Handle Legacy Button Webhooks (fallback)
    if (req.body.type === 'automation') {
      console.log('🔲 BUTTON WEBHOOK RECEIVED (Legacy)');
      console.log('⚠️  Button webhooks do not provide page IDs automatically');
      console.log('💡 Recommendation: Use Integration Webhooks instead for automatic page IDs');
      
      res.status(400).json({
        error: 'Button webhooks not supported',
        message: 'Please use Integration Webhooks or add Page ID to your button payload',
        recommendation: 'Switch to Integration Webhooks for automatic page ID detection',
        timestamp: new Date().toISOString()
      });
      
      return;
    }

    // STEP 4: Unknown webhook format
    console.log('❓ Unknown webhook format received');
    res.status(400).json({
      error: 'Unknown webhook format',
      message: 'Webhook must be either verification token or Integration webhook event',
      receivedFormat: req.body.object || req.body.type || 'unknown',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    
    res.status(500).json({
      error: 'Webhook processing failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get email content from Notion page
async function getEmailContent(pageId) {
  try {
    console.log(`📖 Fetching content for page: ${pageId}`);

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
  console.log(`🔧 Version: 3.0 - Integration Webhooks + Button Webhook Support`);
  console.log(`📊 Enhanced logging enabled for debugging`);
  console.log(`🔐 Supports verification tokens and Integration webhook events`);
});
