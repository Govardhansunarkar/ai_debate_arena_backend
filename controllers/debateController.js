const axios = require('axios');
const { Debate, debates, rooms } = require('../models/index');
const { analyzeDebateArgument } = require('../utils/debateArgumentAnalysis');
const { buildProgressiveDebateResponse } = require('../utils/debateResponseEngine');
const { calculateQualityBasedPoints } = require('../utils/advancedScoringSystem');

// =====================================================
// Similarity Detection - Prevent Repetitive Arguments
// =====================================================
const calculateSimilarity = (str1, str2) => {
  // Simple similarity check - counts common words
  const words1 = str1.toLowerCase().split(/\s+/);
  const words2 = str2.toLowerCase().split(/\s+/);
  
  const commonWords = words1.filter(word => 
    word.length > 4 && words2.includes(word)
  );
  
  // Similarity score: 0-1 (1 = identical)
  const maxLength = Math.max(words1.length, words2.length);
  return commonWords.length / maxLength;
};

const isRepetitiveResponse = (response, debateHistory) => {
  if (!debateHistory || debateHistory.length === 0) return false;
  
  // Check against recent arguments (last 5)
  const recentArguments = debateHistory
    .slice(-5)
    .map(item => item.text || item)
    .filter(text => text);
  
  for (const prevArg of recentArguments) {
    const similarity = calculateSimilarity(response, prevArg);
    if (similarity > 0.5) {
      console.log(`[Repetition Check] Detected ${(similarity * 100).toFixed(0)}% similarity with previous argument`);
      return true;
    }
  }
  
  return false;
};

// =====================================================
// NVIDIA API Integration Function (works with Nemotron models)
// =====================================================
const callNvidiaAPI = async (prompt, apiKey, apiUrl, model) => {
  try {
    console.log('[NVIDIA] Calling API with model:', model);
    
    // Ensure we have the full endpoint URL
    const endpoint = apiUrl.includes('/chat/completions') 
      ? apiUrl 
      : (apiUrl.replace(/\/$/, '') + '/chat/completions');
    
    console.log('[NVIDIA] Using endpoint:', endpoint);
    
    const requestBody = {
      model: model,
      messages: [
        { 
          role: 'system', 
          content: 'You are a debate participant. Provide counter-arguments in 2-3 sentences. Be respectful but firm.'
        },
        { 
          role: 'user', 
          content: prompt 
        }
      ],
      max_tokens: 1000,
      temperature: 0.7,
      top_p: 0.95
    };
    
    const response = await axios.post(
      endpoint,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('[NVIDIA] Response status:', response.status);
    
    // Extract the message content from the response
    let aiResponse = '';
    if (response.data?.choices?.[0]?.message) {
      // Handle different response formats
      const message = response.data.choices[0].message;
      aiResponse = (message.content || message.text || JSON.stringify(message)).trim();
    }
    
    if (!aiResponse || aiResponse.startsWith('{')) {
      console.error('[NVIDIA] Parsing error. Message object:', response.data?.choices?.[0]?.message);
      throw new Error('Could not parse NVIDIA response');
    }
    
    console.log('[NVIDIA] ✓ Response generated successfully');
    return aiResponse;
  } catch (error) {
    console.error('[NVIDIA] ⚠ API Error:', error.message);
    if (error.response) {
      console.error('[NVIDIA] Status:', error.response.status);
      console.error('[NVIDIA] Data:', error.response.data);
    }
    throw error;
  }
};

// Start a debate
exports.startDebate = (req, res) => {
  try {
    const { roomCode, topic, players } = req.body;
    
    console.log('[startDebate] Received request:', { roomCode, topic, playersCount: players?.length });
    console.log('[startDebate] Rooms in storage:', Array.from(rooms.keys()));
    
    const room = rooms.get(roomCode);
    if (!room) {
      console.error('[startDebate] Room not found with code:', roomCode);
      return res.status(404).json({ success: false, error: 'Room not found', receivedCode: roomCode, availableCodes: Array.from(rooms.keys()) });
    }
    
    console.log('[startDebate] Found room:', room.code);
    
    const debate = new Debate(room.id, topic, players);
    debates.set(debate.id, debate);
    room.status = 'active';
    
    console.log('[startDebate] Debate created:', debate.id);
    
    res.status(201).json({
      success: true,
      debate: {
        id: debate.id,
        topic: debate.topic,
        players: debate.players,
        status: debate.status,
        startTime: debate.startTime
      }
    });
  } catch (error) {
    console.error('[startDebate] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get debate
exports.getDebate = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    res.json({
      success: true,
      debate: {
        id: debate.id,
        topic: debate.topic,
        players: debate.players,
        status: debate.status,
        messages: debate.messages,
        scores: debate.scores
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// End debate
exports.endDebate = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    debate.status = 'completed';
    debate.endTime = new Date();
    
    res.json({
      success: true,
      message: 'Debate ended',
      debate: {
        id: debate.id,
        status: debate.status,
        endTime: debate.endTime
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get results
exports.getResults = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    res.json({
      success: true,
      results: {
        debateId: debate.id,
        topic: debate.topic,
        duration: debate.endTime ? debate.endTime - debate.startTime : null,
        scores: debate.scores,
        messageCount: debate.messages.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get AI Feedback
exports.getAIFeedback = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    // Placeholder for AI feedback
    const feedback = {
      debateId: debate.id,
      timestamp: new Date(),
      feedback: {
        communication: {
          score: 75,
          comment: 'Good clarity and articulation'
        },
        logic: {
          score: 80,
          comment: 'Strong logical arguments'
        },
        confidence: {
          score: 70,
          comment: 'Good confidence overall'
        },
        rebuttal: {
          score: 65,
          comment: 'Room for improvement in counter-arguments'
        }
      },
      suggestions: [
        'Use more specific examples',
        'Improve response time to counter-arguments',
        'Build stronger closing statements'
      ]
    };
    
    res.json({ success: true, feedback });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Analyze debate with NVIDIA LLM (tracks debate history and provides AI feedback)
exports.analyzeWithOpenAI = async (req, res) => {
  try {
    const { speeches, topic } = req.body;

    // Validate input
    if (!speeches || !Array.isArray(speeches) || speeches.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Speeches must be a non-empty array",
        received: { speeches: speeches?.length || 'null' }
      });
    }

    if (!topic) {
      return res.status(400).json({ success: false, error: "Topic is required" });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const nvidiaApiUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const nvidiaModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

    // Filter user speeches (speaker === "user")
    const userSpeeches = speeches.filter(s => s.speaker === 'user').map(s => s.text).join('\n\n');
    
    // Format all speeches with alternating speaker labels for context
    const speechText = speeches
      .map((s, idx) => {
        const speaker = s.speaker === 'user' ? '👤 YOU' : '🤖 OPPONENT';
        return `${speaker} (Speech ${idx + 1}): ${s.text}`;
      })
      .join("\n\n");

    const feedbackPrompt = `You are a friendly debate coach helping beginner debaters improve. You explain things in simple, easy-to-understand language.

Review this debate on the topic: "${topic}"

DEBATE TRANSCRIPT:
${speechText}

---

Analyze THE USER'S ARGUMENTS (marked as 👤 YOU) and give feedback that a beginner can understand and use.

IMPORTANT GRADING INSTRUCTIONS:
Calculate a grade for the user based on these factors ONLY:
- Did they explain their idea clearly? (0-2 points)
- Did they use examples or real stories? (0-2 points)
- Did they answer what the other person said? (0-2 points)
- Did their arguments make sense together? (0-2 points)
- Were they easy to understand? (0-2 points)

Total score = sum of all factors (scale 1-10)
DO NOT give everyone 7.5! Look at what they actually did.

IMPORTANT: Use simple, friendly language. Avoid complex terms. Explain like you're talking to a friend!

Provide feedback in this exact JSON structure:

{
  "overall_score": <CALCULATED number 1-10 based on the 5 factors above>,
  "summary": "<1-2 simple sentences about how they did>",
  "strengths": [
    "<easy explanation of what was good - mention a specific thing they said>",
    "<easy explanation of what was good - mention a specific thing they said>",
    "<easy explanation of what was good - mention a specific thing they said>"
  ],
  "weaknesses": [
    "<easy explanation of what to work on>",
    "<easy explanation of what to work on>",
    "<easy explanation of what to work on>"
  ],
  "key_points": [
    "<their best argument in simple terms>",
    "<another good point they made>",
    "<another thing they said well>"
  ],
  "recommendations": [
    "<simple tip they can try next time>",
    "<simple tip they can try next time>",
    "<simple tip they can try next time>"
  ]
}

SCORING EXAMPLES:
- Score 9-10: Clear explanations + good examples + answered all points + arguments made sense + easy to follow
- Score 7-8: Mostly clear + some examples + answered some points + mostly made sense + mostly easy to follow
- Score 5-6: Somewhat clear + few examples + answered few points + some confusion + hard to follow sometimes
- Score 3-4: Not very clear + no examples + didn't answer points + confusing logic + hard to follow
- Score 1-2: Very unclear + no examples + ignored opponent + no logic + very hard to follow

Return ONLY valid JSON, no markdown or extra text.`;


    try {
      if (nvidiaApiKey) {
        // Use NVIDIA LLM for analysis
        console.log('[analyzeWithOpenAI] Using NVIDIA LLM for feedback analysis');
        
        const nvidiaResponse = await axios.post(
          `${nvidiaApiUrl}/chat/completions`,
          {
            model: nvidiaModel,
            messages: [
              {
                role: 'system',
                content: `You are a friendly and encouraging debate coach. You help beginner debaters by giving simple, easy-to-understand feedback and keep response in 2-3 lines only. 
                
You explain things clearly without using confusing terms. Your goal is to:
1. Make the person feel good about what they did well
2. Give them specific, easy tips to improve
3. Use simple language that anyone can understand
4. Be encouraging and supportive

Remember: You're talking to beginners, so keep it simple and friendly!`
              },
              {
                role: 'user',
                content: feedbackPrompt
              }
            ],
            max_tokens: 1500,
            temperature: 0.7,
            top_p: 0.95
          },
          {
            headers: {
              'Authorization': `Bearer ${nvidiaApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        const analysisText = nvidiaResponse.data?.choices?.[0]?.message?.content;
        console.log('[analyzeWithOpenAI] NVIDIA Response:', analysisText);

        if (!analysisText) {
          throw new Error('No analysis text from NVIDIA');
        }

        // Parse JSON response
        let analysis = JSON.parse(analysisText);
        
        res.json({ success: true, analysis });
      } else {
        throw new Error('NVIDIA API key not configured');
      }
    } catch (llmError) {
      console.error('[analyzeWithOpenAI] LLM Error:', llmError.message);
      
      // Calculate dynamic fallback grade based on debate performance
      const userSpeeches = speeches.filter(s => s.speaker === 'user') || [];
      const speechCount = userSpeeches.length;
      const totalWords = userSpeeches.reduce((sum, s) => (sum + (s.text?.split(' ').length || 0)), 0);
      const avgWordsPerSpeech = speechCount > 0 ? totalWords / speechCount : 0;
      
      let baseScore = 5; // Start at 5
      
      // Add points based on speech count (0-2 points)
      if (speechCount >= 4) baseScore += 2;
      else if (speechCount >= 2) baseScore += 1;
      
      // Add points based on speech length (0-2 points) 
      if (avgWordsPerSpeech >= 50) baseScore += 2;
      else if (avgWordsPerSpeech >= 25) baseScore += 1;
      
      // Add points based on points earned (0-2 points)
      const totalPoints = userSpeeches.reduce((sum, s) => (sum + (s.points || 0)), 0);
      if (totalPoints >= 30) baseScore += 2;
      else if (totalPoints >= 15) baseScore += 1;
      
      // Add points for debate engagement (0-2 points)
      if (speeches.length >= 6) baseScore += 2;
      else if (speeches.length >= 4) baseScore += 1;
      
      // Cap score at 10
      const calculatedScore = Math.min(Math.max(baseScore, 1), 10);
      
      // Fallback to template response if LLM fails
      const fallbackAnalysis = {
        overall_score: calculatedScore,
        summary: `Good job in the debate! You had ${speechCount} turn${speechCount !== 1 ? 's' : ''} and shared your ideas. Keep practicing to get better!`,
        strengths: [
          "You participated in the debate and shared your thoughts",
          "You tried to explain your ideas to the other person",
          "You kept going and didn't give up",
        ],
        weaknesses: [
          "You could add more examples from real life",
          "You could explain your ideas a bit more",
          "You could ask questions when the other person makes points",
        ],
        key_points: [
          "You shared your main idea with the other person",
          "You showed you were thinking about the topic",
          "You were respectful during the debate",
        ],
        recommendations: [
          "Next time, find 1-2 real examples to prove your point",
          "Take a moment to think before you respond",
          "Ask the other person questions about what they said",
        ],
      };
      
      res.json({ success: true, analysis: fallbackAnalysis });
    }
  } catch (error) {
    console.error('[analyzeWithOpenAI] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Analyze debate with Gemini (also uses NVIDIA LLM for consistency)
exports.analyzeWithGemini = async (req, res) => {
  try {
    const { speeches, topic } = req.body;

    // Validate input
    if (!speeches || !Array.isArray(speeches) || speeches.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Speeches must be a non-empty array",
        received: { speeches: speeches?.length || 'null' }
      });
    }

    if (!topic) {
      return res.status(400).json({ success: false, error: "Topic is required" });
    }

    // Since we're using NVIDIA LLM exclusively now, return success
    // The analyzeWithOpenAI function (which uses NVIDIA) is the primary feedback engine
    res.json({ 
      success: true, 
      analysis: null, // Frontend will use OpenAI analysis (which is actually NVIDIA LLM)
      note: "Using primary LLM feedback analysis" 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Helper function to generate intelligent fallback responses based on debate context
const generateIntelligentFallback = (userArgument, topic, debateContext) => {
  const debateHistoryCount = debateContext ? debateContext.length : 0;
  
  // Analyze user argument for key topics
  const argWords = userArgument.toLowerCase().split(/\s+/);
  
  // Strategy-based responses that actually reference counterpoints
  const strategicResponses = {
    early: [
      "I understand your perspective on this, but data shows that actually works against your argument.",
      "That's a common misconception. Let me explain why the evidence contradicts that point.",
      "I see the logic, but you haven't addressed the core issue: the practical implementation challenges.",
      "Your argument overlooks a critical detail that changes the entire outcome.",
      "While that sounds logical, real-world examples demonstrate the opposite effect."
    ],
    middle: [
      "You make a valid attempt, but my earlier point about [the fundamental challenge] directly contradicts that.",
      "Building on what I said before, this actually strengthens my position even further.",
      "I appreciate the effort, but that doesn't address my core concern about feasibility.",
      "That argument fails because it ignores the systemic issues I raised.",
      "You're making an assumption that I've already proven false in earlier statements."
    ],
    late: [
      "After all the evidence we've discussed, your position still doesn't hold up to scrutiny.",
      "Your argument is contradicted by the multiple points I've already established.",
      "This doesn't change the fundamental weakness in your position that I've highlighted.",
      "You're repeating an argument I've already dismantled with concrete evidence.",
      "Your conclusion ignores all the counterpoints I've systematically presented."
    ]
  };

  // Pick response based on debate stage
  let responses;
  if (debateHistoryCount < 3) {
    responses = strategicResponses.early;
  } else if (debateHistoryCount < 7) {
    responses = strategicResponses.middle;
  } else {
    responses = strategicResponses.late;
  }

  return responses[Math.floor(Math.random() * responses.length)];
};

// Get AI Response to user's argument - NOW WITH SMART DEBATE ENGINE
exports.getAIResponse = async (req, res) => {
  try {
    const { userArgument, topic, debateContext } = req.body;

    console.log('[getAIResponse] Received:', { userArgument, topic, contextLength: debateContext?.length || 0 });

    if (!userArgument || !topic) {
      return res.status(400).json({ 
        success: false, 
        error: "userArgument and topic are required" 
      });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const nvidiaApiUrl = process.env.NVIDIA_API_URL || 'https://api.nvcf.nvidia.com/v2/nvcf/pureexec';
    const nvidiaModel = process.env.NVIDIA_MODEL || 'meta-llama-3.1-405b-instruct';
    const aiProvider = process.env.AI_PROVIDER || 'openai';
    
    // Prepare debate history for context
    const conversationHistory = (debateContext && Array.isArray(debateContext))
      ? debateContext
          .filter(item => item && item.text)
          .map((item, idx) => `${item.speaker === "user" ? 'You' : 'Opponent'}: ${item.text}`)
          .join("\n\n")
      : "This is the opening of the debate.";

    // Analyze the user's argument for weaknesses
    const argumentAnalysis = analyzeDebateArgument(userArgument, topic, debateContext);
    console.log('[getAIResponse] Argument analysis:', argumentAnalysis);

    let aiResponse = null;
    let engineUsed = 'smart-engine';

    // Build enhanced prompt with argument analysis
    let attackPoints = [];
    const strengthAnalysis = argumentAnalysis.strength;
    
    if (!strengthAnalysis.analysis.includes("evidence-based")) {
      attackPoints.push("- Point out the lack of empirical evidence or data to support their claim");
    }
    if (!strengthAnalysis.analysis.includes("logical-flow")) {
      attackPoints.push("- Identify logical gaps or non-sequiturs in their reasoning");
    }
    if (strengthAnalysis.analysis.includes("short-argument")) {
      attackPoints.push("- Demand specific, concrete examples rather than vague statements");
    }
    
    // Extract previous arguments to avoid repetition
    const previousArguments = (debateContext && Array.isArray(debateContext))
      ? debateContext
          .filter(item => item && item.text)
          .map(item => item.text.toLowerCase())
      : [];
    
    const topicSpecificGuide = argumentAnalysis.topicPoints 
      ? `\n\nCOMMON COUNTER-ARGUMENTS FOR THIS TOPIC:\n${argumentAnalysis.topicPoints.counterpoints.slice(0, 3).join("\n")}`
      : "";
    
    const prompt = `You are a PROFESSIONAL DEBATE PARTICIPANT in a STRUCTURED DEBATE.

DEBATE TOPIC: "${topic}"

DEBATE HISTORY SO FAR:
${conversationHistory}

YOUR OPPONENT JUST ARGUED: "${userArgument}"

YOUR TASK:
You must provide a GENUINE COUNTER-ARGUMENT, not just criticism. Like a real debate, you should:

1. ACKNOWLEDGE their point (don't dismiss it rudely)
2. PRESENT YOUR OPPOSITE POSITION clearly
3. PROVIDE REAL REASONING or evidence for why their position has flaws
4. OFFER AN ALTERNATIVE PERSPECTIVE they haven't considered

CRITICAL RULES:
- DO NOT REPEAT or paraphrase what they just said
- DO NOT use the exact same argument they already made
- DO NOT agree with them - present a genuine alternative view
- DO PROVIDE CONCRETE REASONING or examples
- BE RESPECTFUL but firm in your counter-argument
- FOLLOW REAL DEBATE STRUCTURE (acknowledgment → counter-point → reasoning)

STRUCTURE YOUR RESPONSE LIKE THIS:
1. First 1-2 words: Acknowledge their point briefly (e.g., "While you're right that...")
2. Middle: Present your counter-perspective (e.g., "...the reality is that...")
3. End: Provide reasoning or an alternative consideration (e.g., "...which is why...")

EXAMPLE DEBATE FLOW:
User: "Phones distract students and reduce focus in class."
AI: "While that's true in some cases, schools can implement usage policies instead of banning them entirely, which actually teaches digital responsibility."

User: "But students will misuse them anyway."
AI: "However, research shows that regulated access actually improves learning outcomes compared to complete bans, as students can use them for quick research."

NOW GENERATE YOUR COUNTER-ARGUMENT:
- Be genuine and thoughtful
- Don't repeat previous arguments from the debate history
- Provide 2-3 sentences with real reasoning
- Sound like an intelligent debate participant, not a robot${topicSpecificGuide}

Output ONLY your debate response (2-3 sentences max). No explanations.`;

    // TRY PRIMARY PROVIDER (based on AI_PROVIDER setting)
    if (aiProvider === 'nvidia' && nvidiaApiKey) {
      try {
        console.log('[getAIResponse] Using NVIDIA as primary provider');
        aiResponse = await callNvidiaAPI(prompt, nvidiaApiKey, nvidiaApiUrl, nvidiaModel);
        engineUsed = 'nvidia';
        console.log('[getAIResponse] ✓ NVIDIA response generated:', aiResponse);
      } catch (nvidiaError) {
        console.error('[getAIResponse] ⚠ NVIDIA failed:', nvidiaError.message);
        console.log('[getAIResponse] Attempting fallback to OpenAI...');
        aiResponse = null;
      }
    }
    
    // TRY OPENAI IF PRIMARY PROVIDER UNAVAILABLE OR NOT NVIDIA
    if (!aiResponse && openaiApiKey) {
      try {
        console.log('[getAIResponse] Using OpenAI as primary provider');
        
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              { 
                role: 'system', 
                content: 'You are a professional debate participant who provides genuine counter-arguments (not repetition). Like a real debate, acknowledge valid points while presenting your opposite position with real reasoning. Never repeat arguments already made in the debate. Be respectful but firm.'
              },
              { 
                role: 'user', 
                content: prompt 
              }
            ],
            max_tokens: 150,
            temperature: 0.75
          },
          {
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );

        aiResponse = response.data.choices[0].message.content.trim();
        engineUsed = 'openai';
        console.log('[getAIResponse] ✓ OpenAI response generated:', aiResponse);

      } catch (openaiError) {
        console.error('[getAIResponse] ⚠ OpenAI failed:', openaiError.message);
        console.log('[getAIResponse] Falling back to smart debate engine...');
        aiResponse = null;
      }
    }

    // IF NO OPENAI RESPONSE OR NO API KEY, USE SMART DEBATE ENGINE
    if (!aiResponse) {
      console.log('[getAIResponse] Using smart debate response engine (fallback)');
      aiResponse = buildProgressiveDebateResponse(userArgument, topic, debateContext);
      console.log('[getAIResponse] ✓ Smart engine response:', aiResponse);
    }

    // CHECK IF RESPONSE IS REPETITIVE - if so, regenerate with smart engine
    if (aiResponse && isRepetitiveResponse(aiResponse, debateContext)) {
      console.log('[getAIResponse] ⚠ Detected repetitive response, regenerating with smart engine...');
      aiResponse = buildProgressiveDebateResponse(userArgument, topic, debateContext);
      engineUsed = 'smart-engine-repetition-fix';
      console.log('[getAIResponse] ✓ New response generated:', aiResponse);
    }

    // Calculate points based on argument QUALITY, not length
    const scoreResult = calculateQualityBasedPoints(userArgument);
    const points = scoreResult.points;
    
    console.log('[getAIResponse] ✓ Quality-based scoring:', {
      qualityScore: scoreResult.qualityScore,
      points: points,
      analysis: scoreResult.analysis.breakdown
    });

    res.json({
      success: true,
      response: aiResponse,
      points: points,
      qualityScore: scoreResult.qualityScore,
      scoreBreakdown: scoreResult.analysis.breakdown,
      engine: engineUsed,
      turnNumber: debateContext ? debateContext.length : 0
    });

  } catch (error) {
    console.error('[getAIResponse] Error:', error);
    
    // FINAL FALLBACK - emergency response
    const emergencyResponse = `That's an interesting perspective, but I have to respectfully disagree with your argument about "${userArgument.substring(0, 50)}..." because the evidence suggests something quite different.`;
    
    res.json({
      success: true,
      response: emergencyResponse,
      points: 8,
      engine: 'emergency-fallback'
    });
  }
};
