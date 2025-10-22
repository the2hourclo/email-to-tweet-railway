# Content-to-Tweets Skill - Complete Package

This directory contains everything you need to create your new content-to-tweets skill with proper API mode detection and quality standards.

## What's Included

### Core Skill File
- **SKILL.md** - The main skill instructions with:
  - Automatic API vs Chat mode detection
  - Quality standards and validation
  - Complete CTB framework
  - Proper output formatting (## TWEET #N:)
  - No need for system prompt overrides

### Reference Files
- **references/example-posts.md** - High-quality example tweets showing:
  - Natural conversational tone
  - Proper What-Why-Where structure
  - Contextual CTB examples
  - Key patterns and what to avoid

- **references/ctb-categories.md** - Detailed CTB framework with:
  - 5 category types with examples
  - How to select the right category
  - Common mistakes to avoid
  - Perfect CTB checklist

## How to Create the New Skill

### Step 1: Delete Old Skill
1. Go to Anthropic Console: https://console.anthropic.com/
2. Navigate to Skills section
3. Delete the existing `content-to-tweets` skill (ID: `skill_01SALXgCNgsvghBCYiczfhWW`)

### Step 2: Create New Skill
1. Click "Create New Skill"
2. Choose "Custom Skill"
3. Set skill name: `content-to-tweets`
4. Upload all files from this `new-skill` directory:
   - `SKILL.md` (main instructions)
   - `references/example-posts.md`
   - `references/ctb-categories.md`

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

- **API Mode**: Generates ALL 5-10 tweet concepts immediately in a single response
- **Chat Mode**: Presents one concept at a time, asks for approval between concepts

**No system prompt override needed** - the skill handles this internally.

### 2. Quality References
The skill references example files to maintain quality:
- Uses `references/example-posts.md` for structural guidance
- Uses `references/ctb-categories.md` for CTA selection
- Emphasizes "use as guide, not template"

### 3. Proper Output Format
Ensures consistent markdown format that your parser expects:
```
## TWEET #1: [Title]

**Post 1:**
```
[Content]
```

**Post 2:**
```
[Content]
```

**CTB Tweet:**
```
[CTA with link at end]
```
```

### 4. Built-in Quality Validation
Before outputting each tweet, the skill validates:
- Single aha moment per tweet
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
4. Skill generates 5-10 complete tweet concepts (API mode)
5. Parser extracts all concepts from markdown output
6. App creates 5-10 pages in Shortform database
7. Each page contains one tweet concept with all posts

### Success Criteria:
- ✅ 5+ pages created in Shortform database per email
- ✅ Each page has proper CTB structure
- ✅ Quality matches the demo examples
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

Expected output: 5-10 complete tweet concepts in proper format

### Full Integration Test
1. Go to your Notion E-mails database
2. Create/update a test email page with content
3. Check Shortform database for new pages
4. Verify quality matches examples

## Troubleshooting

### Issue: Only 1 concept generated
**Cause**: Skill might be in chat mode
**Fix**: Verify skill file has proper API mode detection (should be in SKILL.md)

### Issue: Quality doesn't match demo
**Cause**: Reference files not uploaded or not being used
**Fix**: Ensure `references/example-posts.md` is uploaded with skill

### Issue: Parser finds 0 concepts
**Cause**: Output format mismatch
**Fix**: Check skill output format is `## TWEET #N:` (with H2 headers)

### Issue: "Should I proceed?" appears in output
**Cause**: Skill defaulted to chat mode
**Fix**: This shouldn't happen in API calls - verify mode detection logic in SKILL.md

## What Changed from Previous Version

### Removed:
- ❌ System prompt override in index.js
- ❌ Conversational pauses in API mode
- ❌ Generic quality instructions

### Added:
- ✅ Automatic mode detection
- ✅ Quality reference files
- ✅ Detailed CTB framework
- ✅ Built-in validation
- ✅ Better examples and patterns

## Next Steps After Skill Creation

1. **Create the new skill** in Anthropic Console with these files
2. **Copy the new skill ID**
3. **Update Railway environment** variable
4. **Test with sample content** using test-with-content.js
5. **Verify output quality** matches reference examples
6. **Test full integration** with Notion webhook

If everything works, you should see multiple high-quality tweet concepts generated automatically, each in its own Notion page, all matching the quality standards from your demo.

## Questions?

If the skill doesn't behave as expected:
1. Check Railway logs for errors
2. Verify skill ID is correct in environment
3. Test with test-with-content.js to isolate issues
4. Check that all reference files were uploaded with the skill

The skill is designed to be self-contained and require no system prompt overrides. All the heavy lifting happens within the skill itself.
