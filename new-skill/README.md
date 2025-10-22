# Content-to-Posts Skill - Complete Package

This directory contains everything you need to create your new content-to-posts skill with proper API mode detection and quality standards.

## What's Included

### Core Skill File
- **SKILL.md** - The main skill instructions with:
  - **🚨 CRITICAL: 500-character limit per post (NOT 280!)**
  - Automatic API vs Chat mode detection
  - Quality standards and validation
  - Complete CTB framework
  - Proper output formatting (## TWEET #N:)
  - No need for system prompt overrides

## How to Create the New Skill

### Step 1: Delete Old Skill
1. Go to Anthropic Console: https://console.anthropic.com/
2. Navigate to Skills section
3. Delete the existing `content-to-tweets` skill (ID: `skill_01SALXgCNgsvghBCYiczfhWW`)

### Step 2: Create New Skill
1. Click "Create New Skill"
2. Choose "Custom Skill"
3. Set skill name: `content-to-posts`
4. Upload the `SKILL.md` file from this `new-skill` directory

### Step 3: Get New Skill ID
1. After creation, copy the new skill ID (will be something like `skill_01XXXXXXXXXX`)
2. Keep this ID handy for the next step

### Step 4: Update Railway Environment
1. Go to Railway dashboard: https://railway.app/
2. Find your `email-to-tweet-railway` project
3. Go to Variables/Environment
4. Update `CONTENT_TO_TWEETS_SKILL_ID` with your new skill ID
5. Save and redeploy

## Key Improvements in This Version

### 1. API Mode Auto-Detection
The skill now automatically detects whether it's being called via API (non-interactive) or chat (interactive):

- **API Mode**: Generates ALL 5-10 post concepts immediately in a single response
- **Chat Mode**: Presents one concept at a time, asks for approval between concepts

**No system prompt override needed** - the skill handles this internally.

### 2. 500-Character Limit Enforcement
**🚨 CRITICAL: This skill uses 500-character limit per post (NOT 280!)**
- Multiple emphatic reminders throughout SKILL.md
- "API Override" instruction to ignore 280-character Twitter defaults
- Quality validation checks enforce 500-character max

### 3. Proper Output Format
Ensures consistent markdown format that your parser expects:
```
## POST #1: [Title]

**Post 1:**
```
[Content]
```

**Post 2:**
```
[Content]
```

**CTA Post:**
```
[CTA with link at end]
```
```

### 4. Built-in Quality Validation
Before outputting each post, the skill validates:
- Single aha moment per post
- What-Why-Where cycles complete
- Character limits (500 max per post)
- Natural flow between posts
- Unique, contextual CTAs
- Copy-ready format

## Expected Behavior After Deployment

### What Should Happen:
1. Email page created/updated in Notion E-mails database
2. Webhook triggers your Railway app
3. App calls Skills API with email content
4. Skill generates 5-10 complete post concepts (API mode)
5. Parser extracts all concepts from markdown output
6. App creates 5-10 pages in Shortform database
7. Each page contains one post concept with all posts

### Success Criteria:
- ✅ 5+ pages created in Shortform database per email
- ✅ Each page has proper CTB structure
- ✅ Quality matches expected standards
- ✅ No "Should I proceed?" pauses
- ✅ Character counts under 500 per post
- ✅ Natural conversational tone

## Testing the New Skill

### Quick Test (Recommended)
Use the existing test file with new skill ID:

```bash
# Update .env with new skill ID
CONTENT_TO_TWEETS_SKILL_ID=skill_01YOURNEWSKILLID

# Run test
node test-with-content.js
```

Expected output: 5-10 complete post concepts in proper format

### Full Integration Test
1. Go to your Notion E-mails database
2. Create/update a test email page with content
3. Check Shortform database for new pages
4. Verify quality matches examples

## Troubleshooting

### Issue: Only 1 concept generated
**Cause**: Skill might be in chat mode
**Fix**: Verify skill file has proper API mode detection (should be in SKILL.md)

### Issue: Posts are cut off at 280 characters
**Cause**: Skill defaulting to Twitter's 280-character limit
**Fix**: Verify SKILL.md has "NOT 280!" emphasis throughout - should use 500-character max

### Issue: Parser finds 0 concepts
**Cause**: Output format mismatch
**Fix**: Check skill output format is `## POST #N:` (with H2 headers)

### Issue: "Should I proceed?" appears in output
**Cause**: Skill defaulted to chat mode
**Fix**: This shouldn't happen in API calls - verify mode detection logic in SKILL.md

## What Changed from Previous Version

### Removed:
- ❌ System prompt override in index.js
- ❌ Conversational pauses in API mode
- ❌ Generic quality instructions
- ❌ Reference files (poor quality examples removed)

### Added:
- ✅ **🚨 CRITICAL: 500-character limit (NOT 280!) emphasized throughout**
- ✅ Automatic mode detection
- ✅ API Override instructions to ignore Twitter 280-character defaults
- ✅ Detailed CTB framework
- ✅ Built-in validation

## Next Steps After Skill Creation

1. **Create the new skill** in Anthropic Console with SKILL.md
2. **Copy the new skill ID**
3. **Update Railway environment** variable
4. **Test with sample content** using test-with-content.js
5. **Verify posts use 500 characters (NOT 280!)**
6. **Test full integration** with Notion webhook

If everything works, you should see multiple high-quality post concepts generated automatically, each in its own Notion page, with posts using the full 500-character limit.

## Questions?

If the skill doesn't behave as expected:
1. Check Railway logs for errors
2. Verify skill ID is correct in environment
3. Test with test-with-content.js to isolate issues
4. Verify posts are using 500 characters, not cutting off at 280

The skill is designed to be self-contained and require no system prompt overrides. All the heavy lifting happens within the skill itself, with strong emphasis on the 500-character limit.
