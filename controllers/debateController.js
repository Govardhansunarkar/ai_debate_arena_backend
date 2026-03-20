const { Debate, debates, rooms } = require('../models/index');
const { analyzeDebateArgument } = require('../utils/debateArgumentAnalysis');
const { buildProgressiveDebateResponse } = require('../utils/debateResponseEngine');
const { calculateQualityBasedPoints } = require('../utils/advancedScoringSystem');

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

// Analyze debate with OpenAI
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

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(400).json({ 
        success: false, 
        error: "OpenAI API key not configured" 
      });
    }

    // Format speeches for analysis
    const speechText = speeches
      .map((s, idx) => `Speech ${idx + 1}: ${s.text}`)
      .join("\n\n");

    const prompt = `
You are an expert debate coach and speech analyst. Analyze the following debate speeches on the topic: "${topic}"

SPEECHES:
${speechText}

Provide a detailed analysis in JSON format with the following structure:
{
  "overall_score": <1-10>,
  "summary": "<brief overall performance summary>",
  "strengths": [<list of specific strengths>],
  "weaknesses": [<list of areas for improvement>],
  "key_points": [<list of strong arguments made>],
  "recommendations": [<list of specific recommendations>]
}

Be specific, constructive, and encouraging. Focus on:
- Clarity and articulation
- Logical reasoning
- Evidence and examples
- Counter-argument strength
- Confidence and delivery
- Time management`;

    // Call OpenAI API (simulated for demo)
    const analysis = {
      overall_score: 7.5,
      summary:
        "Strong performance with good articulation and logical reasoning. Room for improvement in counter-arguments.",
      strengths: [
        "Clear and articulate speech",
        "Well-structured arguments",
        "Good use of examples",
      ],
      weaknesses: [
        "Could provide more empirical evidence",
        "Response time to counter-arguments could be faster",
      ],
      key_points: [
        "Primary argument was well-supported",
        "Effective use of real-world examples",
      ],
      recommendations: [
        "Practice counter-argument preparation",
        "Use more recent statistics",
        "Work on quicker response time",
      ],
    };

    res.json({ success: true, analysis });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Analyze debate with Gemini
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

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.json({ 
        success: true, 
        analysis: {
          overall_score: 7,
          summary: "Good debate performance. Keep practicing!",
          strengths: ["Clear communication"],
          weaknesses: ["Could improve evidence"],
          recommendations: ["Practice more examples"],
        }
      });
    }

    // Gemini analysis (simulated for demo)
    const analysis = {
      overall_score: 7.8,
      summary:
        "Excellent performance with strong reasoning. Consider developing deeper analysis.",
      strengths: [
        "Compelling argumentation",
        "Respectful tone maintained",
        "Logical flow",
      ],
      weaknesses: [
        "Limited counter-argument preparation",
        "Could engage more with opponent",
      ],
      recommendations: [
        "Study common counter-arguments",
        "Practice active listening",
        "Improve debate technique",
      ],
    };

    res.json({ success: true, analysis });
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
    let useOpenAI = false;

    // TRY OPENAI FIRST
    if (openaiApiKey) {
      try {
        const axios = require('axios');
        useOpenAI = true;
        
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
        
        const topicSpecificGuide = argumentAnalysis.topicPoints 
          ? `\n\nTOPIC-SPECIFIC INSIGHTS:\nCommon counterpoints for this topic: ${argumentAnalysis.topicPoints.counterpoints.slice(0, 2).join(", ")}`
          : "";
        
        const prompt = `You are a STRONG debate opponent in a real debate. Your goal is to WIN by attacking your opponent's weak arguments.

DEBATE TOPIC: "${topic}"

RECENT DEBATE HISTORY:
${conversationHistory}

OPPONENT JUST CLAIMED: "${userArgument}"

WEAKNESSES IN THEIR ARGUMENT TO ATTACK:
${attackPoints.length > 0 ? attackPoints.join("\n") : "- Their argument lacks depth and doesn't address counterarguments"}

YOU MUST:
1. Attack their specific claim - don't be generic
2. Reference what they just said - show you're engaging, not just delivering a canned response
3. Present a counter-claim that opposes theirs
4. Provide evidence, logic, or a real example
5. Be AGGRESSIVE but respectful

Write a 2-3 sentence counter-argument that:
- Directly contradicts their claim
- Points out what's wrong with their logic
- Establishes your superior position
Be specific. If they said X, explain why X is wrong.

Output ONLY the debate response, nothing else.${topicSpecificGuide}`;

        console.log('[getAIResponse] Calling OpenAI API');
        
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              { 
                role: 'system', 
                content: 'You are a cutting-edge debate opponent in a formal debate. You provide aggressive, intelligent counter-arguments that directly attack your opponent\'s claims and reference their specific statements. You never give generic responses. You build on previous debate points and systematically dismantle weak arguments.'
              },
              { 
                role: 'user', 
                content: prompt 
              }
            ],
            max_tokens: 250,
            temperature: 0.85
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
      engine: useOpenAI ? 'openai' : 'smart-engine',
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
