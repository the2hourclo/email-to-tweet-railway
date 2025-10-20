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

// Main webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const { page_id } = req.body;
    
    if (!page_id) {
      return res.status(400).json({ error: 'Missing page_id in request body' });
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

  return content.trim();
}

// Get prompt from Notion page
async function getPromptFromNotion() {
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

  return prompt.trim();
}

// Generate tweets using Claude
async function generateTweets(emailContent, prompt) {
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
}

// Create pages in Short Form database
async function createShortFormPages(tweetsData, emailPageId) {
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
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Email-to-Tweet server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});
