// Email to Tweet Railway Server
// Converts Notion emails to Twitter threads using Claude AI
const express = require('express');
const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');

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
    timestamp: new Date().toISOString()
  });
});

// Main webhook endpoint with debug logging
app.post('/webhook', async (req, res) => {
  try {
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('Query params:', JSON.stringify(req.query, null, 2));
    console.log('========================');
    
    const { page_id } = req.body;
    
    if (!page_id) {
      console.log('ERROR: No page_id found in request body');
      console.log('Available keys in body:', Object.keys(req.body));
      return res.status(400).json({ 
        error: 'Missing page_id in request body',
        received_keys: Object.keys(req.body),
        body: req.body
      });
    }

    console.log(`Processing email page: ${page_id}`);

    // 1. Fetch email content from Notion
    const emailContent = await getEmailContent(page_id);
    console.log('Email content fetched successfully');

    // 2. Get prompt from Notion page
    const prompt = await getPromptFromNotion();
    console.log('Prompt fetched successfully');

    // 3. Generate tweets with Claude
    const tweets = await generateTweets(emailContent, prompt);
    console.log('Tweets generated successfully');

    // 4. Create pages in Short Form database
    const results = await createShortFormPages(tweets, page_id);
    console.log('Short form pages created successfully');

    res.json({
      success: true,
      message: `Created ${results.length} Twitter thread concepts`,
      results: results
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({
      error: 'Failed to process email',
      details: error.message
    });
  }
});

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
        content += block.paragraph.rich_text.map(text => text.plain_text).join('') + '\n';
      }
    }

    if (!content.trim()) {
      throw new Error('No content found in the email page');
    }

    return content.trim();
  } catch (error) {
    console.error('Error fetching email content:', error);
    throw new Error(`Failed to fetch email content: ${error.message}`);
  }
}

// Get prompt from Notion page
async function getPromptFromNotion() {
  try {
    if (!process.env.PROMPT_PAGE_ID) {
      // Fallback prompt if no page ID provided
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
- Return results in JSON format with threads array`;
    }

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

    return prompt.trim() || 'Create engaging Twitter threads from the email content provided.';
  } catch (error) {
    console.error('Error fetching prompt:', error);
    // Return fallback prompt if page fetch fails
    return 'Create engaging Twitter threads from the email content provided.';
  }
}

// Generate tweets using Claude
async function generateTweets(emailContent, prompt) {
  try {
    const fullPrompt = `${prompt}

EMAIL CONTENT:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK}

Generate 5-7 Twitter thread concepts in JSON format:
{
  "threads": [
    {
      "title": "Thread concept title",
      "tweets": ["Tweet 1", "Tweet 2", "Tweet 3"]
    }
  ]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    
    try {
      return JSON.parse(content);
    } catch (e) {
      // Fallback if JSON parsing fails
      return {
        threads: [{
          title: "Generated Content",
          tweets: [content]
        }]
      };
    }
  } catch (error) {
    console.error('Error generating tweets:', error);
    throw new Error(`Failed to generate tweets: ${error.message}`);
  }
}

// Create pages in Short Form database
async function createShortFormPages(tweetsData, emailPageId) {
  try {
    const results = [];

    for (const thread of tweetsData.threads) {
      const content = thread.tweets.join('\n\n');
      
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
        url: response.url
      });
    }

    return results;
  } catch (error) {
    console.error('Error creating short form pages:', error);
    throw new Error(`Failed to create pages: ${error.message}`);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Email-to-Tweet server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});
