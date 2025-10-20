// Updated functions to create pages that follow the 2HourMan prompt structure exactly

// UPDATED: Generate tweets following the exact 2HourMan prompt structure
async function generateTweetsWithFullStructure(emailContent, prompt) {
  try {
    const fullPrompt = `${prompt}

SOURCE CONTENT TO ANALYZE:
${emailContent}

NEWSLETTER LINK: ${process.env.NEWSLETTER_LINK || 'https://your-newsletter.com'}

Please follow the 2HourMan methodology exactly as outlined above. For each tweet concept:

1. Apply Phase 1: Content Analysis to identify 3-5 distinct tweet concepts
2. For each concept, follow Phase 2: Sequential Tweet Development
3. Use the exact output format specified in the prompt

Provide the complete structured analysis for each tweet concept, including:
- Main Content (split into multiple posts if over 500 characters)
- Single Aha Moment identification
- What-Why-Where Cycle Check
- Character counts for each post
- CTA Tweet
- All quality validation checks

Format exactly as specified in your methodology.`;

    console.log('\n📤 SENDING FULL STRUCTURE REQUEST TO CLAUDE:');
    console.log('Full prompt length:', fullPrompt.length);

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL_NAME,
      max_tokens: 8000, // Increased for full analysis
      messages: [{ role: 'user', content: fullPrompt }]
    });

    const content = response.content[0].text;
    
    console.log('\n📥 CLAUDE RESPONSE WITH FULL STRUCTURE:');
    console.log('Response length:', content.length);
    console.log('First 500 characters:', content.substring(0, 500));
    
    // Parse the full structured response
    const tweetConcepts = parseFullStructuredResponse(content);
    
    console.log(`✅ Successfully parsed ${tweetConcepts.length} tweet concepts with full structure`);
    
    return { tweetConcepts };

  } catch (error) {
    console.error('❌ Error generating tweets with full structure:', error);
    
    // Fallback response
    return {
      tweetConcepts: [{
        number: 1,
        title: 'Error in Tweet Generation',
        mainContent: {
          posts: [`Error generating tweets: ${error.message}`],
          characterCounts: [0]
        },
        ahamoment: 'Error occurred during tweet generation',
        whatWhyWhere: {
          what: 'Error in processing',
          why: 'System encountered an error',
          where: 'Check logs for details'
        },
        cta: 'Please check the system logs for details.',
        qualityValidation: 'Error - validation not completed'
      }]
    };
  }
}

// ROBUST: Parse the full structured response from Claude
function parseFullStructuredResponse(content) {
  const tweetConcepts = [];
  
  try {
    console.log('\n🔍 PARSING FULL STRUCTURED RESPONSE:');
    
    // Look for "TWEET #X:" pattern to identify concepts
    const conceptMatches = content.match(/TWEET\s*#\d+:[\s\S]*?(?=TWEET\s*#\d+:|$)/gi);
    
    if (conceptMatches && conceptMatches.length > 0) {
      console.log(`✅ Found ${conceptMatches.length} tweet concepts`);
      
      conceptMatches.forEach((match, index) => {
        try {
          const conceptNum = index + 1;
          console.log(`\n📋 Parsing concept ${conceptNum}...`);
          
          // Extract title/description
          const titleMatch = match.match(/TWEET\s*#\d+:\s*([^\n]+)/i);
          const title = titleMatch ? titleMatch[1].trim() : `Tweet Concept ${conceptNum}`;
          
          // Extract main content (could be multiple posts)
          const mainContentMatch = match.match(/Main Content:\s*([\s\S]*?)(?=\n\nSingle Aha Moment:|Single Aha Moment:|$)/i);
          const mainContentText = mainContentMatch ? mainContentMatch[1].trim() : 'Content extraction failed';
          
          // Parse main content for multiple posts
          const posts = parseMainContentPosts(mainContentText);
          
          // Extract aha moment
          const ahaMatch = match.match(/Single Aha Moment:\s*([\s\S]*?)(?=\n\nWhat-Why-Where|What-Why-Where|$)/i);
          const ahamoment = ahaMatch ? ahaMatch[1].trim() : 'Aha moment not identified';
          
          // Extract What-Why-Where analysis
          const whatWhyWhereMatch = match.match(/What-Why-Where Check:\s*([\s\S]*?)(?=\n\nCharacter Count|Character Count|$)/i);
          const whatWhyWhere = parseWhatWhyWhere(whatWhyWhereMatch ? whatWhyWhereMatch[1] : '');
          
          // Extract character counts
          const charCountMatch = match.match(/Character Count[s]?:\s*([\s\S]*?)(?=\n\n---|CTA Tweet:|$)/i);
          const characterCounts = parseCharacterCounts(charCountMatch ? charCountMatch[1] : '', posts.length);
          
          // Extract CTA tweet
          const ctaMatch = match.match(/CTA Tweet:\s*([\s\S]*?)(?=\n\nCTA Uniqueness|CTA Uniqueness|Character Count|$)/i);
          const cta = ctaMatch ? ctaMatch[1].trim() : 'CTA not found';
          
          // Extract quality validation
          const qualityMatch = match.match(/Quality Validation:\s*([\s\S]*?)(?=\n\n|$)/i);
          const qualityValidation = qualityMatch ? qualityMatch[1].trim() : 'Quality validation not found';
          
          const concept = {
            number: conceptNum,
            title: title,
            mainContent: {
              posts: posts,
              characterCounts: characterCounts
            },
            ahamoment: ahamoment,
            whatWhyWhere: whatWhyWhere,
            cta: cta,
            qualityValidation: qualityValidation
          };
          
          tweetConcepts.push(concept);
          console.log(`✅ Successfully parsed concept ${conceptNum}: "${title}"`);
          
        } catch (parseError) {
          console.error(`❌ Error parsing concept ${index + 1}:`, parseError);
          
          // Add error concept
          tweetConcepts.push({
            number: index + 1,
            title: `Concept ${index + 1} - Parse Error`,
            mainContent: {
              posts: ['Failed to parse this concept from Claude response'],
              characterCounts: [0]
            },
            ahamoment: 'Parse error occurred',
            whatWhyWhere: {
              what: 'Unable to extract analysis',
              why: 'Parsing failed',
              where: 'Check logs for details'
            },
            cta: 'Check logs for details',
            qualityValidation: 'Parse error - validation not completed'
          });
        }
      });
    } else {
      console.log('⚠️ No structured concepts found, creating fallback...');
      
      // Fallback: treat entire response as one concept
      tweetConcepts.push({
        number: 1,
        title: 'Fallback Concept',
        mainContent: {
          posts: [content.substring(0, 500).trim()],
          characterCounts: [content.substring(0, 500).length]
        },
        ahamoment: 'Unable to identify specific aha moment from response',
        whatWhyWhere: {
          what: 'Content analysis incomplete',
          why: 'Response format not recognized',
          where: 'Review Claude response structure'
        },
        cta: 'Review the full response above for insights',
        qualityValidation: 'Fallback concept - manual review needed'
      });
    }
    
  } catch (error) {
    console.error('❌ Complete parsing failure:', error);
    
    // Final fallback
    tweetConcepts.push({
      number: 1,
      title: 'Parse Error',
      mainContent: {
        posts: ['Complete parsing failure occurred'],
        characterCounts: [0]
      },
      ahamoment: 'Parse error occurred',
      whatWhyWhere: {
        what: 'Parsing system failed',
        why: 'Unexpected response format',
        where: 'Check system logs'
      },
      cta: 'Check logs for technical details',
      qualityValidation: 'Error - validation not completed'
    });
  }
  
  console.log(`📊 Final parsing result: ${tweetConcepts.length} concepts created`);
  return tweetConcepts;
}

// Helper function to parse main content posts (handles splits)
function parseMainContentPosts(contentText) {
  try {
    // Look for "Post 1:", "Post 2:" pattern for split posts
    const postMatches = contentText.match(/Post\s+\d+:\s*([\s\S]*?)(?=Post\s+\d+:|$)/gi);
    
    if (postMatches && postMatches.length > 1) {
      // Multiple posts found
      return postMatches.map(match => {
        const postContent = match.replace(/Post\s+\d+:\s*/i, '').trim();
        return postContent;
      });
    } else {
      // Single post
      return [contentText];
    }
  } catch (error) {
    console.error('Error parsing main content posts:', error);
    return [contentText];
  }
}

// Helper function to parse What-Why-Where analysis
function parseWhatWhyWhere(analysisText) {
  try {
    const whatMatch = analysisText.match(/✅\s*WHAT:\s*([^\n]+)/i);
    const whyMatch = analysisText.match(/✅\s*WHY:\s*([^\n]+)/i);
    const whereMatch = analysisText.match(/✅\s*WHERE:\s*([^\n]+)/i);
    
    return {
      what: whatMatch ? whatMatch[1].trim() : 'WHAT analysis not found',
      why: whyMatch ? whyMatch[1].trim() : 'WHY analysis not found',
      where: whereMatch ? whereMatch[1].trim() : 'WHERE analysis not found'
    };
  } catch (error) {
    console.error('Error parsing What-Why-Where:', error);
    return {
      what: 'Analysis parsing failed',
      why: 'Analysis parsing failed',
      where: 'Analysis parsing failed'
    };
  }
}

// Helper function to parse character counts
function parseCharacterCounts(countText, expectedPosts) {
  try {
    const countMatches = countText.match(/(\d+)\/500/g);
    
    if (countMatches && countMatches.length > 0) {
      return countMatches.map(match => {
        const count = match.match(/(\d+)/)[1];
        return parseInt(count);
      });
    } else {
      // Fallback: create default counts
      return Array(expectedPosts).fill(0);
    }
  } catch (error) {
    console.error('Error parsing character counts:', error);
    return Array(expectedPosts).fill(0);
  }
}

// UPDATED: Create pages following the 2HourMan structure exactly
async function createFullStructurePages(tweetsData, emailPageId) {
  try {
    const results = [];

    console.log('\n📝 CREATING FULL STRUCTURE PAGES:');
    console.log(`Processing ${tweetsData.tweetConcepts.length} tweet concepts...`);

    for (let i = 0; i < tweetsData.tweetConcepts.length; i++) {
      const concept = tweetsData.tweetConcepts[i];
      
      console.log(`\n🧵 CREATING PAGE FOR CONCEPT ${i + 1}:`);
      console.log(`Title: ${concept.title}`);
      console.log(`Posts: ${concept.mainContent.posts.length}`);

      // Create blocks following the exact 2HourMan format
      const blocks = [];
      
      // TWEET #X: Title
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: `TWEET #${concept.number}: ${concept.title}` }
          }]
        }
      });
      
      // Main Content section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Main Content:' }
          }]
        }
      });
      
      // Add each post
      concept.mainContent.posts.forEach((post, postIndex) => {
        if (concept.mainContent.posts.length > 1) {
          // Multiple posts - add post header
          blocks.push({
            object: 'block',
            type: 'heading_3',
            heading_3: {
              rich_text: [{
                type: 'text',
                text: { content: `Post ${postIndex + 1}:` }
              }]
            }
          });
        }
        
        // Post content
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: post },
              annotations: { bold: true }
            }]
          }
        });
        
        // Character count for this post
        const charCount = concept.mainContent.characterCounts[postIndex] || post.length;
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: `Character Count: ${charCount}/500 ${charCount <= 500 ? '✅' : '❌'}` }
            }]
          }
        });
        
        // Add divider between posts
        if (postIndex < concept.mainContent.posts.length - 1) {
          blocks.push({
            object: 'block',
            type: 'divider',
            divider: {}
          });
        }
      });
      
      // Single Aha Moment section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Single Aha Moment:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: concept.ahamoment }
          }]
        }
      });
      
      // What-Why-Where Cycle Check section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'What-Why-Where Cycle Check:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: '✅ WHAT: ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: concept.whatWhyWhere.what }
            }
          ]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: '✅ WHY: ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: concept.whatWhyWhere.why }
            }
          ]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: '✅ WHERE: ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: concept.whatWhyWhere.where }
            }
          ]
        }
      });
      
      // Divider before CTA
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      
      // CTA Tweet section
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'CTA Tweet:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: concept.cta }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: `CTA Character Count: ${concept.cta.length}/500 ${concept.cta.length <= 500 ? '✅' : '❌'}` }
          }]
        }
      });
      
      // Quality Validation section
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Quality Validation:' }
          }]
        }
      });
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: concept.qualityValidation }
          }]
        }
      });

      try {
        // Create the page with full structure
        const response = await notion.pages.create({
          parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
          properties: {
            'Title': {
              title: [{ text: { content: `TWEET #${concept.number}: ${concept.title}` } }]
            },
            'E-mails': {
              relation: [{ id: emailPageId }]
            }
          },
          children: blocks
        });

        console.log(`✅ Successfully created full structure page ${i + 1}: ${response.id}`);
        console.log(`   Title: TWEET #${concept.number}: ${concept.title}`);
        console.log(`   Blocks added: ${blocks.length}`);
        console.log(`   Posts: ${concept.mainContent.posts.length}`);
        
        results.push({ 
          id: response.id, 
          title: `TWEET #${concept.number}: ${concept.title}`,
          blocks_count: blocks.length,
          posts_count: concept.mainContent.posts.length,
          concept_number: concept.number
        });

      } catch (pageError) {
        console.error(`❌ Failed to create page ${i + 1}:`, pageError);
        
        // Create minimal fallback page
        try {
          const fallbackResponse = await notion.pages.create({
            parent: { database_id: process.env.SHORTFORM_DATABASE_ID },
            properties: {
              'Title': {
                title: [{ text: { content: `Concept ${i + 1} - Creation Error` } }]
              },
              'E-mails': {
                relation: [{ id: emailPageId }]
              }
            },
            children: [{
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{
                  type: 'text',
                  text: { content: `Error creating full structure page for concept ${i + 1}. Check logs for details.\n\nOriginal content:\n${concept.mainContent.posts.join('\n\n')}` }
                }]
              }
            }]
          });
          
          results.push({ 
            id: fallbackResponse.id, 
            title: `Concept ${i + 1} - Error`,
            error: true
          });
        } catch (fallbackError) {
          console.error(`❌ Even fallback creation failed for concept ${i + 1}:`, fallbackError);
        }
      }
    }

    console.log(`\n✅ COMPLETED: Created ${results.length} full structure pages`);
    return results;

  } catch (error) {
    console.error('❌ Error in createFullStructurePages:', error);
    throw new Error(`Failed to create full structure pages in Notion: ${error.message}`);
  }
}

// UPDATED: Main automation function to use full structure
async function processEmailAutomation(pageId) {
  try {
    console.log(`\n🚀 === STARTING AUTOMATION ===`);
    console.log(`📄 Target Page ID: ${pageId}`);

    // Steps 1-4 remain the same...
    // [Previous verification and content extraction code]

    // Step 5: Generate tweets using full 2HourMan structure
    console.log('🤖 Step 5: Generating tweet concepts with full 2HourMan methodology...');
    const tweetsData = await generateTweetsWithFullStructure(emailContent, prompt);
    console.log(`✅ Generated ${tweetsData.tweetConcepts.length} tweet concepts with full analysis`);

    // Step 6: Create pages with complete 2HourMan structure
    console.log('📝 Step 6: Creating full structure pages following 2HourMan format...');
    const createdPages = await createFullStructurePages(tweetsData, pageId);
    console.log(`✅ Created ${createdPages.length} pages with complete structure`); 

    console.log('🎉 === AUTOMATION COMPLETED ===');
    return {
      status: 'success',
      email_page_id: pageId,
      content_length: emailContent.length,
      concepts_generated: tweetsData.tweetConcepts.length,
      pages_created: createdPages.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Automation processing error:', error);
    throw new Error(`Automation failed: ${error.message}`);
  }
}
