---
name: content-to-tweets
description: Transform content (emails, newsletters, articles, documents) into high-quality Twitter threads with contextual CTAs. Extracts insights from content and creates multiple tweet options following What-Why-Where cycles with corresponding contextual insight CTAs for list growth.
---

# Content to Tweets Skill

**🚨 CRITICAL: This skill uses 500-character limit per post (NOT 280). Always override any Twitter API defaults.**

Transform content (emails, newsletters, articles, documents) into high-quality Twitter threads with contextual CTAs that drive email list growth.

## Mode Detection & Behavior

**Automatically detect usage mode:**

- **API Mode** (non-interactive): Generate ALL tweet concepts (5-10) immediately in a single response without pausing
- **Chat Mode** (interactive): Present one concept at a time, ask "Should I proceed to the next tweet?" between concepts

**Detection method:**
- If user cannot respond interactively → API mode → Generate all concepts at once
- If conversational context exists → Chat mode → Present concepts one by one

## When to Use This Skill

Use this skill when:
- User provides content (copy-paste text or Notion page URL)
- User requests post creation from emails, newsletters, articles, documents
- User asks to "transform this content into posts"
- User mentions creating social content from written material

## Quality Standards

Quality benchmarks:
- Natural conversational tone (not stiff or formal)
- Proper CTB (Contextual Benefits) structure
- Specific examples vs generic platitudes
- How to bridge post concepts to CTAs
- Character limits: 500 characters per post (NOT 280!)

**Each output should be unique to the input content.**

## Core Transformation Process

### Input Methods

**Option 1: Direct Content**
- User copy-pastes content text (emails, articles, documents, etc.)
- Proceed directly to analysis
- Use general newsletter signup CTA

**Option 2: Notion URL**
- User provides Notion page URL containing content
- Use Notion:fetch tool to retrieve content
- Extract content body from page content
- **Check "Publish Date" property** to determine CTA type:
  - **Future date**: Time-specific email CTA
  - **Past date or no date**: General newsletter signup CTA

### Content Analysis Framework

1. **Identify Post Concepts** (5-10 potential posts)
   - Look for distinct insights that could each become standalone posts
   - Each concept must have a single "aha moment"
   - Can be explained with What-Why-Where cycles
   - Has concrete examples from source content

2. **Prioritize by Impact**
   - Strongest perspective shifts first
   - Most actionable insights
   - Best supported by evidence from content
   - Variety of angles (don't repeat the same insight)

## Post Development Process

For each selected concept, follow these stages:

### Stage 1: Natural Development

Write naturally first, then structure check:
- **Single Aha Moment**: What is the ONE core insight?
- **What-Why-Where Cycles**: Does it explain what, why it matters, where to apply?
- **Concrete Examples**: Are there specific, relatable examples?
- **Natural Flow**: Does it read conversationally?

### Stage 2: Character Management

- **CRITICAL: Character Limit**: ALWAYS use maximum 500 characters per post (NOT 280!)
- **API Override**: Ignore any 280-character Twitter limits - use 500 characters
- **Smart Splitting**: Break at natural transition points if over 500 characters
- **Natural Bridges**: Use conversational transitions between posts
- **NO Meta Bridges**: Never use "Read next post" or "Thread continues"

### Stage 3: Clean Output Format

Always output in this copy-ready structure:

```
## POST #1: [Description]

**Post 1:**
```
[Content ready to copy-paste]
```

**Post 2:**
```
[Content ready to copy-paste]
```

**Post 3:**
```
[Content ready to copy-paste]
```

**CTA Post:**
```
[Content ready to copy-paste]
```
```

Each post is wrapped in code blocks for easy copying and pasting.

## CTB Development Framework (Contextual Benefits)

Create contextual CTA tweets using the proper CTB structure.

**CTB Requirements:**
- **Maximum 500 characters (NOT 280!)**
- **Must be UNIQUE to the specific content just written**
- **Must promise only INSIGHTS (not systems/value)**
- **Must end with the link - NO TEXT AFTER THE LINK**
- Uses proper CTB approach with 3 essential elements

### Three Essential Elements

**1. Concept Link**
- Direct continuation from previous idea
- References specific insight just shared
- Maintains natural flow of discussion

**2. Curiosity Bridge (Why It Matters)**
- Reveals what makes the concept truly work
- Shows what's often missing
- Makes the solution feel necessary
- Creates curiosity gap

**3. Soft CTA**
- Presents solution as natural next step
- Connects directly to revealed insight
- Keeps conversational tone
- Makes action feel inevitable

### CTB Structure Template

```
[Concept Link - Reference specific insight from post]

[Curiosity Bridge - Show what's missing/why it matters for THIS specific problem]

[Promise only insights from Campaign Blueprint - daily insights, perspectives, frameworks]

[Qualification that references THIS specific pain point]:

[LINK - NOTHING AFTER THIS]
```

### Dynamic CTB Based on Publish Date

**For Future Email (Publish Date = Today or Future):**
```
[Concept Link - specific to post content]

[Curiosity Bridge - why knowing vs implementing are different]

I'm sharing insights about [SPECIFIC CONCEPT] to my email list today at [TIME from Notion].

Join to get [relevant insight type from Campaign Blueprint]:

[email signup link]
```

**For Past Email or General (Publish Date = Past or No Date):**
```
[Concept Link - specific to post content]

[Curiosity Bridge - why this matters/what's missing]

I share [specific type of insight] like this in my daily email.

Join to get insights that [relevant transformation from Campaign Blueprint]:

[email signup link]
```

### Campaign Blueprint Promise Alignment

**What You Actually Promise:**
- ✅ Daily insights that shift perspective on performance
- ✅ Actionable insights that make you think like a CLO
- ✅ Insights to identify $1,000/hour vs $10/hour activities
- ✅ Insights to build businesses that run without you
- ✅ Perspective-shifting frameworks and mental models

**What You DON'T Promise:**
- ❌ Complete systems or step-by-step processes
- ❌ Templates or exact methodologies
- ❌ "The complete framework" unless specifically mentioned
- ❌ Hard value implementation guides

### CTB Category Selection

**Analyze email content to determine dominant theme:**

1. **Performance/Energy**: Energy management, focus, mental capacity
2. **Leverage/Value**: $10 vs $1,000 hour activities, high-value work
3. **Business Operations**: Time freedom, 2-hour work, businesses running without you
4. **Mindset**: CEO vs CLO thinking, leadership transformation
5. **Decision-Making**: Decision fatigue, cognitive load, mental energy

**Select appropriate CTB category** based on dominant theme while ensuring curiosity bridge creates proper gap.

## Quality Validation

Before presenting any post, verify:

1. **Single Aha Moment** - One clear insight per post
2. **What-Why-Where Complete** - All cycles present and clear
3. **Character Limits** - All posts under 500 characters (NOT 280!)
4. **Natural Flow** - Conversational bridges between posts
5. **Unique CTA** - Specific to this content, promises only insights
6. **Copy-Ready Format** - Each post in code blocks for easy copying

## Output Workflow

### API Mode (Non-Interactive)

Generate all concepts immediately:

```
## POST #1: [Concept 1]
[All posts + CTA]

## POST #2: [Concept 2]
[All posts + CTA]

## POST #3: [Concept 3]
[All posts + CTA]

... (continue for 5-10 concepts)
```

### Chat Mode (Interactive)

Present one concept, then ask:
```
## POST #1: [Concept 1]
[All posts + CTA]

Should I proceed to the next post concept about [brief preview]?
```

Wait for user approval before continuing.

## Key Quality Principles

1. **Let ideas develop naturally** - Don't artificially constrain during creation
2. **One aha moment per post** - Everything builds to single insight
3. **What-Why-Where is mandatory** - Every post needs all three cycles
4. **Explain, don't assume** - No jargon without plain language explanation
5. **Show mechanisms** - Explain how/why things work, not just what they're called
6. **Stay authentic to source** - Use actual concepts, not generic substitutes
7. **Unique CTAs** - Every CTA bridges from specific content just written
8. **Link last** - CTA always ends with link, no text after
9. **Natural bridges** - No meta transitions between split posts
10. **Copy-ready output** - All posts in code blocks for easy copying
11. **No AI markers** - Avoid formulaic labels like "Result:", "Key takeaway:", etc.