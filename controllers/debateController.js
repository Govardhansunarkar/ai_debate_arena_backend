const axios = require('axios');
const { Debate, debates, rooms } = require('../models/index');
const { analyzeDebateArgument } = require('../utils/debateArgumentAnalysis');
const { calculateQualityBasedPoints } = require('../utils/advancedScoringSystem');

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
      max_tokens: 800,  // Reduced from 1000
      temperature: 0.65,  // Reduced from 0.7 for faster generation
      top_p: 0.90  // Reduced from 0.95
    };
    
    const response = await axios.post(
      endpoint,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 12000  // Reduced from 30000 to 12 seconds
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

// Get AI Response to user's argument - WITH STREAMING & TOPIC ENFORCEMENT
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

    // Check if user is going off-topic
    const topicKeywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const userWords = userArgument.toLowerCase().split(/\s+/);
    const topicMatches = topicKeywords.filter(kw => userWords.some(uw => uw.includes(kw))).length;
    const topicRelevance = topicKeywords.length > 0 ? topicMatches / topicKeywords.length : 0;

    // If user is off-topic (less than 30% match), redirect them
    if (topicRelevance < 0.3 && debateContext && debateContext.length > 2) {
      console.log('[getAIResponse] User going off-topic. Relevance:', topicRelevance);
      const redirectResponse = `Let's stay focused on our topic: "${topic}". I appreciate your point, but can you connect it back to the main question?`;
      
      return res.json({
        success: true,
        response: redirectResponse,
        points: 0,
        qualityScore: 0,
        scoreBreakdown: { 'Off-topic': 'Redirecting to main topic' },
        engine: 'topic-enforcement',
        isOffTopic: true
      });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const nvidiaApiUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const nvidiaModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

    // Prepare debate history for context
    const conversationHistory = (debateContext && Array.isArray(debateContext))
      ? debateContext
          .filter(item => item && item.text)
          .map((item, idx) => `${item.speaker === "user" ? 'You' : 'Opponent'}: ${item.text}`)
          .join("\n\n")
      : "This is the opening of the debate.";

    const prompt = `You are a debate opponent in a simple, friendly debate.

DEBATE TOPIC: "${topic}"

DEBATE HISTORY:
${conversationHistory}

THE USER JUST SAID: "${userArgument}"

Your task: Give a SHORT, friendly counter-argument (2-3 sentences MAX).

RULES:
1. Keep it SHORT and SIMPLE - anyone can understand
2. Use everyday words, not fancy language
3. Acknowledge their point, then give your opposite view
4. Add ONE simple reason why your view is better
5. Sound natural, like talking to a friend
6. Stay on the topic: "${topic}"

EXAMPLE:
User: "Remote work helps people focus more."
Response: "I see why you'd think that, but I disagree. Working from home has lots of distractions like family, pets, and chores. Plus, teams work better together in one place."

Now give YOUR response (2-3 sentences only, no more):`;

    let aiResponse = null;
    let engineUsed = 'nvidia';
    try {
      console.log('[getAIResponse] Calling NVIDIA for response');
      aiResponse = await callNvidiaAPI(prompt, nvidiaApiKey, nvidiaApiUrl, nvidiaModel);
      console.log('[getAIResponse] ✓ NVIDIA response received:', aiResponse.substring(0, 100));
    } catch (nvidiaError) {
      console.error('[getAIResponse] NVIDIA failed:', nvidiaError.message);
      
      // Fallback to simple smart response if API fails
      engineUsed = 'smart-fallback';
      const counterarguments = [
        `I understand your point, but I disagree. While what you said sounds right, the real issue is different. Most people miss the fact that there are other important reasons to consider.`,
        `You make a fair point, but let me explain why I think differently. The thing you're not seeing is that in real life, things work in another way.`,
        `That's interesting, but here's my opinion: what you said doesn't show the full picture of "${topic.toLowerCase()}". Let me tell you why it matters.`,
        `I see what you mean, but I think you're missing something important. The real problem is that your view only looks at one side of the story.`,
        `You're right about some things, but consider this: there's a bigger picture here that changes everything about how we should think about this topic.`
      ];
      
      aiResponse = counterarguments[Math.floor(Math.random() * counterarguments.length)];
    }

    // Calculate points based on argument QUALITY
    const scoreResult = calculateQualityBasedPoints(userArgument);
    const points = scoreResult.points;
    
    console.log('[getAIResponse] ✓ Response ready and sent');

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
    
    // Simple emergency response
    const emergencyResponse = `I see your point, but I think differently about "${topic}". Let me explain why my view makes more sense.`;
    
    res.json({
      success: true,
      response: emergencyResponse,
      points: 5,
      engine: 'emergency-fallback'
    });
  }
};
