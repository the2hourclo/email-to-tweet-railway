const express = require('express');
const { Client } = require('@notionhq/client');
// Using the recommended Claude 3.5 Sonnet model
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
    'SHORTFORM_DATABASE_ID'
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
    version: '8.0 - Webhook Fix Implemented',
    endpoints: {
      health: '/',
      webhook: '/webhook'
    },
    config: {
        notionToken: process.env.NOTION_TOKEN ? 'Set' : 'Missing',
        anthropicKey: process.env.ANTHROPIC_API_KEY ? 'Set' : 'Missing',
        emailDbId: process.env.EMAILS_DATABASE_ID ? 'Set' : 'Missing',
        shortFormDbId: process.env.SHORTFORM_DATABASE_ID ? 'Set' : 'Missing',
        promptPage: process.env.PROMPT_PAGE_ID || 'Default Prompt',
    },
    timestamp: new Date().toISOString()
  });
});

// Webhook endpoint for Notion database button
app.post('/webhook', async (req, res) => {
  try {
    console.log('\n🔥 === NOTION BUTTON WEBHOOK RECEIVED ===');
    console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
    // Log keys for verification, but skip full body to avoid large output
    console.log('🔍 Top-level Body Keys:', Object.keys(req.body)); 

    let pageId = null;

    // 🏆 PRIMARY CHECK: The confirmed location for Page ID in Database Button Webhooks
    if (req.body.data && req.body.data.id) {
        // Notion database page IDs are nested under data.id
        pageId = req.body.data.id;
        console.log(`✅ Page ID found in req.body.data.id: ${pageId}`);
    } 
    // FALLBACKS (for compatibility with other webhook types if testing payload changed)
    else if (req.body.page_id) {
      pageId = req.body.page_id;
      console.log(`📄 Page ID from page_id field (Fallback 1): ${pageId}`);
    } else if (req.body.id) {
      pageId = req.body.id;
      console.log(`📄 Page ID from id field (Fallback 2): ${pageId}`);
    } else {
      // Deep search for a standard Notion ID format (UUID or 32-char hex)
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

    // Step 1: Verify this

