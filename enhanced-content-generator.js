// Enhanced Multi-Pass Content Generation System
// This replaces your single generateTweetsWithEnhancedQuality() function

const Anthropic = require('@anthropic-ai/sdk');

class EnhancedContentGenerator {
  constructor(anthropicClient, basePrompt) {
    this.anthropic = anthropicClient;
    this.basePrompt = basePrompt;
  }

  async generateTweetsWithMultiPass(emailContent, newsletterLink) {
    console.log('🎯 Starting Multi-Pass Generation Process...');
    
    try {
      // Pass 1: Content Analysis & Strategy
      const analysis = await this.analyzeContent(emailContent);
      console.log('✅ Pass 1: Content Analysis Complete');
      
      // Pass 2: Initial Generation with Analyzed Context
      const initialDraft = await this.generateInitialDraft(emailContent, analysis);
      console.log('✅ Pass 2: Initial Draft Generated');
      
      // Pass 3: Quality Assessment & Gap Identification
      const qualityAssessment = await this.assessQuality(initialDraft);
      console.log('✅ Pass 3: Quality Assessment Complete');
      
      // Pass 4: Targeted Refinement
      let refinedContent;
      if (qualityAssessment.needsRefinement) {
        refinedContent = await this.refineContent(initialDraft, qualityAssessment.feedback);
        console.log('✅ Pass 4: Content Refined');
      } else {
        refinedContent = initialDraft;
        console.log('✅ Pass 4: No refinement needed');
      }
      
      // Pass 5: Final CTA Enhancement
      const finalContent = await this.enhanceCTAs(refinedContent, newsletterLink, analysis);
      console.log('✅ Pass 5: CTAs Enhanced');
      
      // Pass 6: Final Validation
      const validatedContent = await this.finalValidation(finalContent);
      console.log('✅ Pass 6: Final Validation Complete');
      
      console.log('🎉 Multi-Pass Generation Complete');
      return validatedContent;
      
    } catch (error) {
      console.error('❌ Multi-Pass Generation Error:', error);
      // Fallback to single-pass generation
      return this.fallbackGeneration(emailContent);
    }
  }

  // PASS 1: Analyze content for optimal approach
  async analyzeContent(emailContent) {
    const analysisPrompt = `
Analyze this email content to inform tweet generation strategy:

EMAIL CONTENT:
${emailContent}

Analyze for:
1. Content Type: Educational/Story/Framework/Case Study/Contrarian Take
2. Core Theme: What's the main message?
3. Key Insights: List 3-5 standout insights worth tweeting
4. Audience Level: Beginner/Intermediate/Advanced business concepts
5. Emotional Tone: Practical/Inspirational/Contrarian/Analytical
6. Best Thread Starters: Which of these templates would work best?
   - Transformation Story
   - System Breakdown  
   - Results-First Hook
   - Contrarian Take
   - Experience Share

Respond in JSON format:
{
  "contentType": "",
  "coreTheme": "",
  "keyInsights": ["", "", ""],
  "audienceLevel": "",
  "emotionalTone": "",
  "recommendedTemplates": ["", ""],
  "complexityNotes": ""
}`;

    const response = await this.anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME || 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [{ role: 'user', content: analysisPrompt }]
    });

    try {
      return JSON.parse(response.content[0].text);
    } catch (e) {
      console.log('⚠️ Analysis parsing failed, using defaults');
      return {
        contentType: "Educational",
        coreTheme: "Business optimization",
        keyInsights: ["Systems thinking", "Automation", "Efficiency"],
        audienceLevel: "Intermediate",
        emotionalTone: "Practical",
        recommendedTemplates: ["System Breakdown", "Experience Share"],
        complexityNotes: "Standard business content"
      };
    }
  }

  // PASS 2: Generate initial draft with analyzed context
  async generateInitialDraft(emailContent, analysis) {
    const enhancedPrompt = `
CONTENT ANALYSIS CONTEXT:
- Content Type: ${analysis.contentType}
- Core Theme: ${analysis.coreTheme}
- Audience Level: ${analysis.audienceLevel}
- Recommended Templates: ${analysis.recommendedTemplates.join(', ')}
- Key Insights Available: ${analysis.keyInsights.join(', ')}

GENERATION FOCUS:
Based on this analysis, generate tweets that leverage the ${analysis.contentType} format with ${analysis.emotionalTone} tone, targeting ${analysis.audienceLevel} audience.

${this.basePrompt}

EMAIL CONTENT TO TRANSFORM:
${emailContent}

Focus on the recommended templates and ensure each tweet captures one of the identified key insights while maintaining the analyzed emotional tone.`;

    const response = await this.anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME || 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{ role: 'user', content: enhancedPrompt }]
    });

    try {
      return JSON.parse(response.content[0].text);
    } catch (e) {
      console.error('❌ Initial draft JSON parsing failed');
      throw new Error('Failed to generate initial draft');
    }
  }

  // PASS 3: Assess quality and identify specific improvement areas
  async assessQuality(tweetData) {
    const qualityPrompt = `
Assess these tweets against high-quality standards and identify specific improvement areas:

TWEETS TO ASSESS:
${JSON.stringify(tweetData, null, 2)}

QUALITY CRITERIA:
1. Hook Strength: Does each tweet grab attention immediately?
2. Aha Moment Clarity: Is there ONE clear insight per tweet?
3. What-Why-Where Completeness: Are all cycles present and clear?
4. Mechanism Explanation: Are concepts explained, not just named?
5. Audience Context: Is necessary background provided?
6. CTA Specificity: Are CTAs unique and tied to specific content?
7. Natural Flow: Does it sound conversational, not AI-generated?

For each tweet, identify:
- What's working well
- Specific gaps or weaknesses
- Concrete improvement suggestions

Respond in JSON:
{
  "overallQuality": "High/Medium/Low",
  "needsRefinement": true/false,
  "feedback": {
    "tweet1": {
      "strengths": [""],
      "weaknesses": [""],
      "improvements": [""]
    },
    "tweet2": { ... },
    "globalIssues": [""],
    "priorityFixes": [""]
  }
}`;

    const response = await this.anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME || 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: qualityPrompt }]
    });

    try {
      return JSON.parse(response.content[0].text);
    } catch (e) {
      console.log('⚠️ Quality assessment parsing failed, assuming refinement needed');
      return {
        overallQuality: "Medium",
        needsRefinement: true,
        feedback: {
          globalIssues: ["Assessment parsing failed"],
          priorityFixes: ["General improvement pass needed"]
        }
      };
    }
  }

  // PASS 4: Targeted refinement based on quality assessment
  async refineContent(tweetData, qualityFeedback) {
    const refinementPrompt = `
REFINEMENT TASK:
Improve these tweets based on specific quality feedback.

ORIGINAL TWEETS:
${JSON.stringify(tweetData, null, 2)}

QUALITY FEEDBACK:
${JSON.stringify(qualityFeedback, null, 2)}

REFINEMENT INSTRUCTIONS:
1. Address each identified weakness specifically
2. Strengthen hooks where noted
3. Clarify aha moments that are unclear
4. Complete missing What-Why-Where cycles
5. Improve mechanism explanations
6. Enhance audience context where lacking
7. Make CTAs more specific and unique

Maintain the same JSON structure but with improved content. Focus on the priority fixes first.

Requirements:
- Keep character limits under 500 per post
- Maintain authentic conversational tone
- Ensure each improvement directly addresses feedback
- Don't change what's already working well`;

    const response = await this.anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME || 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{ role: 'user', content: refinementPrompt }]
    });

    try {
      return JSON.parse(response.content[0].text);
    } catch (e) {
      console.log('⚠️ Refinement parsing failed, returning original');
      return tweetData;
    }
  }

  // PASS 5: Enhance CTAs with specific newsletter link and bridge language
  async enhanceCTAs(tweetData, newsletterLink, analysis) {
    const ctaPrompt = `
TASK: Enhance CTAs with specific newsletter link and improved bridge language.

CURRENT TWEETS:
${JSON.stringify(tweetData, null, 2)}

NEWSLETTER LINK: ${newsletterLink}

CONTENT CONTEXT:
- Theme: ${analysis.coreTheme}
- Content Type: ${analysis.contentType}
- Key Insights: ${analysis.keyInsights.join(', ')}

CTA ENHANCEMENT REQUIREMENTS:
1. Replace newsletter link placeholders with actual link
2. Create specific bridges that reference the exact concept from each tweet
3. Make each CTA unique to its specific content
4. Ensure link is the final element (nothing after)
5. Keep under 500 characters
6. Make the transition feel natural and valuable

For each tweet, create a CTA that:
- References the specific insight/concept from that tweet
- Creates curiosity about learning more
- Positions the newsletter as the logical next step
- Feels conversational, not salesy

Return the same JSON structure with enhanced CTAs.`;

    const response = await this.anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME || 'claude-3-5-sonnet-20241022',
      max_tokens: 3000,
      messages: [{ role: 'user', content: ctaPrompt }]
    });

    try {
      return JSON.parse(response.content[0].text);
    } catch (e) {
      console.log('⚠️ CTA enhancement parsing failed, returning previous version');
      return tweetData;
    }
  }

  // PASS 6: Final validation and character count verification
  async finalValidation(tweetData) {
    // Validate character counts and structure
    const validatedData = {
      tweetConcepts: tweetData.tweetConcepts.map((tweet, index) => {
        // Validate and fix character counts
        const validatedPosts = tweet.mainContent.posts.map(post => {
          if (post.length > 500) {
            console.log(`⚠️ Tweet ${index + 1} post exceeds 500 chars: ${post.length}`);
            // Truncate if over limit (could be enhanced to split properly)
            return post.substring(0, 497) + '...';
          }
          return post;
        });

        const validatedCharCounts = validatedPosts.map(post => 
          `${post.length}/500 ${post.length <= 500 ? '✅' : '❌'}`
        );

        // Validate CTA length
        let validatedCTA = tweet.cta;
        if (tweet.cta.length > 500) {
          console.log(`⚠️ Tweet ${index + 1} CTA exceeds 500 chars: ${tweet.cta.length}`);
          validatedCTA = tweet.cta.substring(0, 497) + '...';
        }

        return {
          ...tweet,
          mainContent: {
            posts: validatedPosts,
            characterCounts: validatedCharCounts
          },
          cta: validatedCTA
        };
      })
    };

    console.log('✅ Final validation complete - all character limits enforced');
    return validatedData;
  }

  // Fallback single-pass generation if multi-pass fails
  async fallbackGeneration(emailContent) {
    console.log('🔄 Using fallback single-pass generation...');
    
    const response = await this.anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME || 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{ 
        role: 'user', 
        content: `${this.basePrompt}\n\nEMAIL CONTENT:\n${emailContent}` 
      }]
    });

    try {
      return JSON.parse(response.content[0].text);
    } catch (e) {
      console.error('❌ Even fallback generation failed');
      throw new Error('Complete generation failure');
    }
  }
}

module.exports = EnhancedContentGenerator;
