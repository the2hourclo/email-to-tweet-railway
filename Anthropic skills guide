# Anthropic Skills Creation Guide

## What are Anthropic Skills?

Anthropic Skills are custom AI capabilities that extend Claude's functionality. They're defined by a `SKILL.md` file that contains specific instructions for how Claude should behave when the skill is triggered.

## Skill Structure

### Required Files
- `SKILL.md` - Main skill definition (REQUIRED)
- `README.md` - Documentation (optional but recommended)

### SKILL.md Format
```markdown
---
name: skill-name
description: Brief description of what the skill does
---

# Skill Name

Detailed instructions for Claude on how to execute this skill.

## When to Use This Skill
- Trigger conditions
- User input patterns

## Process
1. Step-by-step instructions
2. Input handling
3. Output format

## Quality Standards
- Validation criteria
- Expected outputs
```

## API Integration

### Skills API Endpoint
```
POST https://api.anthropic.com/v1/messages
```

### Headers Required
```javascript
{
  "x-api-key": "your-api-key",
  "content-type": "application/json",
  "anthropic-version": "2023-06-01"
}
```

### Request Body with Skill
```javascript
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 4096,
  "messages": [
    {
      "role": "user", 
      "content": "Transform this email into tweets: [content]"
    }
  ],
  "tools": [
    {
      "type": "custom",
      "name": "content-to-tweets",
      "skill_id": "skill_01XXXXXXXXXX"
    }
  ]
}
```

## Environment Variables for Skills

```bash
# Skill IDs
CONTENT_TO_TWEETS_SKILL_ID=skill_01XXXXXXXXXX
EMAIL_WRITER_SKILL_ID=skill_01YYYYYYYYYY

# API Configuration
ANTHROPIC_API_KEY=your-api-key
```

## Common Skill Patterns

### Content Transformation Skills
- Input: Raw content (emails, articles, documents)
- Process: Extract insights, apply frameworks
- Output: Formatted social media posts, summaries, etc.

### Writing Skills
- Input: Requirements, style guides, examples
- Process: Generate content following specific patterns
- Output: Emails, blog posts, marketing copy

### Analysis Skills
- Input: Data, documents, metrics
- Process: Apply analytical frameworks
- Output: Reports, insights, recommendations

## Best Practices

### 1. Clear Triggering Conditions
```markdown
## When to Use This Skill
Use this skill when:
- User provides content for transformation
- User asks to "transform into tweets"
- User mentions social media creation
```

### 2. Explicit Output Format
```markdown
### Stage 3: Clean Output Format
Always output in this structure:
```
## TWEET #1: [Description]
**Post 1:**
```
[Content]
```
```

### 3. Quality Standards
```markdown
## Quality Validation
Before presenting output, verify:
1. Single aha moment per post
2. Character limits enforced
3. Natural conversational tone
4. Unique contextual CTAs
```

### 4. Mode Detection (API vs Chat)
```markdown
## Mode Detection
- **API Mode**: Generate all concepts immediately
- **Chat Mode**: Present one at a time with approval
```

## Character Limits & Platform Considerations

### Twitter/X Considerations
- **Legacy limit**: 280 characters
- **Current capability**: 500+ characters for longer posts
- **Best practice**: Use 500-character limit for richer content

### Skill Instructions for Character Limits
```markdown
**CRITICAL: Character Limit**: ALWAYS use maximum 500 characters per post (NOT 280!)
**API Override**: Ignore any 280-character Twitter limits - use 500 characters
```

## Testing Skills

### Local Testing Setup
```javascript
// test-skill.js
const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function testSkill(content, skillId) {
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Transform this content: ${content}`
      }
    ],
    tools: [
      {
        type: 'custom',
        name: 'content-to-tweets',
        skill_id: skillId
      }
    ]
  });
  
  return response;
}
```

### Test Commands
```bash
# Test specific skill
node test-skill.js

# Test with sample content
echo "Test content here" | node test-skill.js
```

## Debugging Skills

### Common Issues
1. **Skill not triggering**: Check skill ID and API key
2. **Wrong output format**: Verify SKILL.md instructions
3. **Character limits**: Ensure 500-char limit is enforced
4. **Mode confusion**: Check API vs Chat mode detection

### Debugging Tools
```javascript
// Add logging to see skill responses
console.log('Skill Response:', JSON.stringify(response, null, 2));

// Check for specific output patterns
const hasTweetHeaders = response.content[0].text.includes('## TWEET #');
console.log('Has proper format:', hasTweetHeaders);
```

## Deployment Considerations

### Railway/Vercel Deployment
```javascript
// Make sure environment variables are set
const requiredEnvVars = [
  'ANTHROPIC_API_KEY',
  'CONTENT_TO_TWEETS_SKILL_ID'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
});
```

### Webhook Integration
```javascript
// Express.js webhook handler
app.post('/webhook/notion', async (req, res) => {
  try {
    const { email_content } = req.body;
    
    const response = await callSkill(email_content, process.env.CONTENT_TO_TWEETS_SKILL_ID);
    
    // Process response and create database entries
    await processSkillOutput(response);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

## Skill Management

### Creating New Skills
1. Write SKILL.md file with clear instructions
2. Upload to Anthropic Console
3. Copy skill ID
4. Update environment variables
5. Test with sample content

### Updating Existing Skills
1. Modify SKILL.md file
2. Re-upload to console (same skill ID)
3. Test changes
4. Deploy to production

### Version Control
```bash
# Keep skills in version control
skills/
├── content-to-tweets/
│   ├── SKILL.md
│   ├── README.md
│   └── tests/
├── email-writer/
│   ├── SKILL.md
│   └── README.md
```

This guide should give Claude Code comprehensive knowledge about creating, managing, and debugging Anthropic Skills.
