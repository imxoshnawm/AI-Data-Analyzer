import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY

if(!OPENAI_API_KEY){
  console.warn('OPENAI_API_KEY not set. Create a .env file with OPENAI_API_KEY=...')
}
if(!CLAUDE_API_KEY){
  console.warn('CLAUDE_API_KEY not set.')
}

function buildPrompt(payload){
  const { tables = [], texts = [], notes = '' } = payload || {}
  const meta = {
    tables: tables.map(t=>({ name: t.name, columns: t.columns, row_count: (t.rows||[]).length })),
    text_lengths: texts.map(t=>t.length)
  }
  return {
    system: 'تۆ یاریدەدەری بینینەوەی داتایت. تەنها JSON بدە. هه‌رگیز دەق یان ڕەشەلەق مەهێنە.',
    user: `You are analyzing diverse data (tables/text) to generate comprehensive insights and visualizations.

DATA ANALYSIS REQUIREMENTS:

1. CHARTS - Generate 8-12 meaningful visualizations (REQUIRED):
   - MUST create charts for ALL numeric columns in the data
   - MUST create distribution charts for ALL categorical columns
   - For ANY table with numeric data:
     * Bar/Line charts for trends over time
     * Histograms for value distributions
     * Scatter plots for correlations between 2+ numeric columns
     * Pie charts for categorical breakdowns (if categories < 10)
   - For text/categorical data:
     * Bar charts showing frequency/count distributions
     * Pie charts for percentage breakdowns
   - CRITICAL: Analyze EVERY column and create relevant visualizations
   - Use descriptive titles that explain what the chart shows
   - Never include empty datasets
   - Examples:
     * "Revenue vs Expenses Over Time" (line chart)
     * "Customer Distribution by Region" (bar chart)
     * "Profit Margin Distribution" (histogram)
     * "Sales vs Marketing Spend Correlation" (scatter)
     * "Product Category Market Share" (pie chart)

2. SUMMARY (3-5 sentences):
   - Overview of the dataset scope and key characteristics
   - Main patterns or trends identified
   - Notable statistics or findings

3. INSIGHTS (15-20 bullet points, 1-2 sentences each):
   - MUST BE SPECIFIC with actual data from the text
   - Include exact names, roles, departments, years, publications
   - Mention specific individuals and their achievements
   - Highlight educational backgrounds and career progression
   - Note research areas, publication counts, collaboration patterns
   - Identify skills, expertise levels, and specializations
   - Compare different faculty members or time periods
   - Example: "Dr. Ronyaz Hayyas Mahmood holds both Bachelor's (2007-2008) and Master's (2018-2019) degrees from Salahaddin University-Erbil, with expertise in MIS, HRM, and Organizational Behavior."
   - Example: "The faculty member has published 5 research papers in 2025, focusing on strategic management and organizational behavior, demonstrating active research engagement."

4. EXPLANATIONS (15-25 detailed paragraphs, 5-8 sentences each):
   - CRITICAL: Generate EXTENSIVE, DETAILED explanations with deep analysis
   - Each paragraph MUST be 5-8 sentences minimum (aim for 100-150 words per paragraph)
   - Deep dive into WHY patterns exist with thorough reasoning
   - Provide comprehensive context and implications of findings
   - Include actionable recommendations with detailed steps
   - Connect multiple data points to tell a complete story
   - Discuss potential causes, effects, and future implications
   - Analyze trends from multiple perspectives (organizational, individual, temporal)
   - Include comparative analysis between different groups/periods
   - Discuss best practices and industry standards
   - Provide strategic recommendations for improvement
   - Example: "The concentration of Assistant Lecturers and Professors suggests a well-structured academic hierarchy with clear career progression pathways. This distribution typically indicates a mature institution with both experienced faculty providing leadership and emerging scholars bringing fresh perspectives and research energy. The presence of multiple leadership roles including Deans, Directors, and Department Heads demonstrates significant organizational complexity and administrative capacity. This hierarchical structure supports both teaching excellence through experienced educators and administrative efficiency through distributed leadership responsibilities. Organizations should monitor the balance between senior and junior faculty to ensure effective knowledge transfer, mentorship opportunities, and succession planning. The current distribution suggests healthy organizational dynamics, though attention should be paid to creating clear advancement pathways for junior faculty to prevent talent drain. Regular assessment of faculty development needs and leadership training programs can help maintain this balance while preparing the next generation of academic leaders."

DATA PROVIDED:
Metadata: ${JSON.stringify(meta)}

Tables: ${JSON.stringify(tables).slice(0, 800000)}

Text samples: ${texts.map(t=>t.slice(0,8000)).join('\n---\n')}

Additional notes: ${notes}

RESPOND WITH VALID JSON ONLY:
{"summary":"...","insights":["...","..."],"explanations":["...","..."],"charts":[{"id":"chart1","title":"Descriptive Title","type":"bar","labels":["A","B"],"datasets":[{"label":"Series Name","data":[10,20]}]}]}`
  }
}

app.post('/api/analyze', async (req, res)=>{
  try{
    const { tables = [], texts = [], notes = '' } = req.body || {}
    const { system, user } = buildPrompt({ tables, texts, notes })

    console.log('Analyzing with both OpenAI and Claude...')

    // Call both AIs in parallel
    const [openaiResult, claudeResult] = await Promise.allSettled([
      analyzeWithOpenAI(system, user),
      analyzeWithClaude(system, user)
    ])

    console.log('OpenAI:', openaiResult.status)
    console.log('Claude:', claudeResult.status)

    // Merge results from both AIs
    let mergedResult = {
      summary: '',
      insights: [],
      explanations: [],
      charts: []
    }

    // Get OpenAI result
    if(openaiResult.status === 'fulfilled' && openaiResult.value){
      const openai = openaiResult.value
      mergedResult.summary = openai.summary || ''
      mergedResult.insights = openai.insights || []
      mergedResult.explanations = openai.explanations || []
      mergedResult.charts = openai.charts || []
    }

    // Merge Claude result
    if(claudeResult.status === 'fulfilled' && claudeResult.value){
      const claude = claudeResult.value
      
      // Combine summaries
      if(claude.summary){
        mergedResult.summary = mergedResult.summary 
          ? `${mergedResult.summary}\n\n**Claude's Perspective:** ${claude.summary}`
          : claude.summary
      }
      
      // Merge insights (add Claude's unique insights)
      if(claude.insights && claude.insights.length > 0){
        mergedResult.insights = [...mergedResult.insights, ...claude.insights]
      }
      
      // Merge explanations
      if(claude.explanations && claude.explanations.length > 0){
        mergedResult.explanations = [...mergedResult.explanations, ...claude.explanations]
      }
      
      // Merge charts (Claude might suggest different visualizations)
      if(claude.charts && claude.charts.length > 0){
        mergedResult.charts = [...mergedResult.charts, ...claude.charts]
      }
    }

    // If both failed, return error
    if(openaiResult.status === 'rejected' && claudeResult.status === 'rejected'){
      return res.status(500).json({ error: 'Both AI services failed' })
    }

    res.json(mergedResult)
  }catch(err){
    console.error(err)
    res.status(500).json({ error: 'server_error', message: err.message })
  }
})

// Helper function for OpenAI analysis
async function analyzeWithOpenAI(system, user){
  if(!OPENAI_API_KEY) return null
  
  try{
    const body = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 16000
    }

    const r = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body)
    })
    
    if(!r.ok) return null
    
    const data = await r.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    return JSON.parse(content)
  }catch(err){
    console.error('OpenAI Analysis Error:', err.message)
    return null
  }
}

// Helper function for Claude analysis
async function analyzeWithClaude(system, user){
  if(!CLAUDE_API_KEY) return null
  
  try{
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{ 
        'Content-Type':'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 16000,
        temperature: 0.7,
        system: system,
        messages: [{
          role: 'user',
          content: user + '\n\nIMPORTANT: Respond with valid JSON only in this exact format: {"summary":"...","insights":["..."],"explanations":["..."],"charts":[...]}'
        }]
      })
    })
    
    if(!r.ok) return null
    
    const data = await r.json()
    const text = data.content?.[0]?.text || '{}'
    
    // Try to extract JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if(jsonMatch){
      return JSON.parse(jsonMatch[0])
    }
    
    return null
  }catch(err){
    console.error('Claude Analysis Error:', err.message)
    return null
  }
}

// Multi-AI Chat endpoint
app.post('/api/chat', async (req, res)=>{
  try{
    const { message, context } = req.body || {}
    
    if(!message){
      return res.status(400).json({ error: 'Message is required' })
    }
    
    // Build context from data
    const contextStr = context ? `
DATA CONTEXT:
${JSON.stringify(context).slice(0, 10000)}

User's data is loaded. Answer questions about their data, provide insights, and help with analysis.
` : ''
    
    const userPrompt = `${contextStr}

USER QUESTION: ${message}

IMPORTANT INSTRUCTIONS:
- If the user writes in Kurdish (کوردی), respond in Kurdish
- If the user writes in English, respond in English  
- If the user writes in Arabic, respond in Arabic
- Always match the user's language
- Provide helpful, detailed answers based on the data context (if available) or general knowledge
- Be conversational and friendly`
    
    // Call OpenAI and Claude only
    const [openaiResult, claudeResult] = await Promise.allSettled([
      callOpenAI(userPrompt),
      callClaude(userPrompt)
    ])
    
    // Collect successful responses
    const responses = []
    
    console.log('AI Results:')
    console.log('- OpenAI:', openaiResult.status, openaiResult.value ? 'Success' : 'Failed')
    console.log('- Claude:', claudeResult.status, claudeResult.value ? 'Success' : 'Failed')
    
    if(openaiResult.status === 'fulfilled' && openaiResult.value){
      responses.push({ ai: 'OpenAI GPT-4', response: openaiResult.value })
    } else if(openaiResult.status === 'rejected'){
      console.error('OpenAI rejected:', openaiResult.reason)
    }
    
    if(claudeResult.status === 'fulfilled' && claudeResult.value){
      responses.push({ ai: 'Anthropic Claude', response: claudeResult.value })
    } else if(claudeResult.status === 'rejected'){
      console.error('Claude rejected:', claudeResult.reason)
    }
    
    if(responses.length === 0){
      return res.status(500).json({ error: 'All AI services failed' })
    }
    
    // Merge responses into one unified response
    let mergedResponse = ''
    
    if(responses.length === 1){
      // Only one AI responded
      mergedResponse = responses[0].response
    } else {
      // Both AIs responded - intelligently merge
      const openaiResp = responses.find(r => r.ai.includes('OpenAI'))?.response || ''
      const claudeResp = responses.find(r => r.ai.includes('Claude'))?.response || ''
      
      // Check if both responses are in the same language and similar
      const openaiLang = detectLanguage(openaiResp)
      const claudeLang = detectLanguage(claudeResp)
      
      if(openaiLang === claudeLang && openaiLang !== 'unknown'){
        // Same language - pick the longer/better one or combine smartly
        if(openaiResp.length > claudeResp.length * 1.5){
          mergedResponse = openaiResp
        } else if(claudeResp.length > openaiResp.length * 1.5){
          mergedResponse = claudeResp
        } else {
          // Similar length - combine them
          mergedResponse = `${openaiResp}\n\n${claudeResp}`
        }
      } else {
        // Different languages - use the one that matches user's language
        const userLang = detectLanguage(message)
        if(openaiLang === userLang){
          mergedResponse = openaiResp
        } else if(claudeLang === userLang){
          mergedResponse = claudeResp
        } else {
          // Fallback - use both
          mergedResponse = `${openaiResp}\n\n${claudeResp}`
        }
      }
    }
    
    // Simple language detection helper
    function detectLanguage(text){
      if(/[\u0600-\u06FF]/.test(text) && /[ئ|ێ|ۆ|ڕ|ڵ|ە]/.test(text)) return 'kurdish'
      if(/[\u0600-\u06FF]/.test(text)) return 'arabic'
      if(/[a-zA-Z]/.test(text)) return 'english'
      return 'unknown'
    }
    
    // Step 3: Refine merged response with OpenAI
    console.log('Refining response with OpenAI...')
    const refinedResponse = await refineWithOpenAI(mergedResponse, message)
    let finalResponse = refinedResponse || mergedResponse
    
    // Add AI Data Analyzer signature if asked about model
    const lowerMsg = message.toLowerCase()
    if(lowerMsg.includes('model') || lowerMsg.includes('مۆدڵ') || lowerMsg.includes('ai') || lowerMsg.includes('who are you') || lowerMsg.includes('تۆ کێیت')){
      finalResponse += '\n\n---\n\n*I am **AI Data Analyzer v0.0.1**, powered by advanced AI models including OpenAI GPT-4 and Anthropic Claude, enhanced with custom machine learning algorithms (AI Data Analyzer ML v0.0.2) for data analysis and insights generation.*'
    }
    
    res.json({ 
      message: finalResponse,
      model: 'AI Data Analyzer v0.0.1',
      count: responses.length
    })
    
  }catch(err){
    console.error('Chat Error:', err)
    res.status(500).json({ error: 'server_error', message: err.message })
  }
})

// Refine merged response with OpenAI
async function refineWithOpenAI(mergedText, originalQuestion){
  if(!OPENAI_API_KEY) return null
  
  try{
    const refinePrompt = `You are AI Data Analyzer. You have received multiple AI responses to a user's question. Your job is to combine, refine, and present them as ONE cohesive, natural response.

ORIGINAL QUESTION: ${originalQuestion}

MERGED RESPONSES:
${mergedText}

INSTRUCTIONS:
1. Combine the information from both responses into ONE natural, flowing answer
2. Remove any redundancy or repetition
3. Keep the same language as the original question (Kurdish/English/Arabic)
4. Make it sound like it came from a single AI assistant
5. Keep all important information and insights
6. Be concise but comprehensive
7. Maintain a friendly, helpful tone

Provide ONLY the refined response, nothing else:`

    const r = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{ 
        'Content-Type':'application/json', 
        'Authorization':`Bearer ${OPENAI_API_KEY}` 
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: refinePrompt }],
        temperature: 0.5,
        max_tokens: 1500
      })
    })
    
    if(!r.ok) return null
    
    const data = await r.json()
    const refined = data.choices?.[0]?.message?.content
    
    if(refined && refined.length > 50){
      console.log('✅ Response refined successfully')
      return refined
    }
    
    return null
  }catch(err){
    console.error('Refine Error:', err.message)
    return null
  }
}

// Helper functions for each AI
async function callOpenAI(prompt){
  if(!OPENAI_API_KEY){
    console.log('OpenAI: API key not found')
    return null
  }
  
  try{
    const r = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{ 
        'Content-Type':'application/json', 
        'Authorization':`Bearer ${OPENAI_API_KEY}` 
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      })
    })
    
    if(!r.ok){
      const errorText = await r.text()
      console.error('OpenAI API Error:', r.status, errorText)
      return null
    }
    
    const data = await r.json()
    const text = data.choices?.[0]?.message?.content
    if(!text){
      console.log('OpenAI: No text in response')
      return null
    }
    return text
  }catch(err){
    console.error('OpenAI Error:', err.message)
    return null
  }
}

// Gemini removed - using only OpenAI and Claude

async function callClaude(prompt){
  if(!CLAUDE_API_KEY){
    console.log('Claude: API key not found')
    return null
  }
  
  try{
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{ 
        'Content-Type':'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    })
    
    if(!r.ok){
      const errorText = await r.text()
      console.error('Claude API Error:', r.status, errorText)
      return null
    }
    
    const data = await r.json()
    const text = data.content?.[0]?.text
    if(!text){
      console.log('Claude: No text in response')
      return null
    }
    return text
  }catch(err){
    console.error('Claude Error:', err.message)
    return null
  }
}

app.use(express.static(__dirname))

const port = process.env.PORT || 3000
app.listen(port, ()=>{
  console.log(`Server running on http://localhost:${port}`)
})
