module.exports = (io) => {
  // Track debate rooms and their participants
  const debateRooms = new Map(); // { debateId: { participants: Map(userId -> {playerName, socketId}) } }

  io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    // Join matchmaking queue
    socket.on('join-queue', (data) => {
      console.log(`${data.playerName} joined queue`);
      // Emit match-found after 3-5 seconds (demo behavior)
      setTimeout(() => {
        socket.emit('match-found', {
          debateId: `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        });
      }, 3000 + Math.random() * 2000);
    });

    // Leave matchmaking queue
    socket.on('leave-queue', (data) => {
      console.log('Player left queue');
    });

    // Join debate room
    socket.on('join-debate', (data) => {
      socket.join(data.debateId);
      
      // Initialize room if doesn't exist
      if (!debateRooms.has(data.debateId)) {
        debateRooms.set(data.debateId, { participants: new Map() });
      }
      
      const room = debateRooms.get(data.debateId);
      
      // Add participant to room
      room.participants.set(data.userId, {
        playerName: data.playerName,
        socketId: socket.id,
        roomType: data.roomType || 'user-only',
        joinedAt: new Date()
      });
      
      console.log(`${data.playerName} joined debate ${data.debateId}. Total participants: ${room.participants.size}`);
      
      socket.emit('debate-joined', { 
        message: 'Joined debate successfully',
        participantCount: room.participants.size,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName
        }))
      });
      
      // Notify all participants about new participant
      io.to(data.debateId).emit('player-joined', {
        userId: data.userId,
        playerName: data.playerName,
        totalParticipants: room.participants.size,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName
        }))
      });
    });

    // Send message
    socket.on('send-message', (data) => {
      io.to(data.debateId).emit('receive-message', {
        userId: data.userId,
        playerName: data.playerName,
        text: data.text,
        timestamp: new Date()
      });
    });

    // Raise hand
    socket.on('raise-hand', (data) => {
      io.to(data.debateId).emit('hand-raised', {
        userId: data.userId,
        playerName: data.playerName
      });
    });

    // Lower hand
    socket.on('lower-hand', (data) => {
      io.to(data.debateId).emit('hand-lowered', {
        userId: data.userId,
        playerName: data.playerName
      });
    });

    // Debate timer update
    socket.on('timer-update', (data) => {
      io.to(data.debateId).emit('timer-updated', {
        timeRemaining: data.timeRemaining
      });
    });

    // End debate
    socket.on('end-debate', (data) => {
      io.to(data.debateId).emit('debate-ended', {
        message: 'Debate has ended'
      });
      
      // Clean up room
      if (debateRooms.has(data.debateId)) {
        debateRooms.delete(data.debateId);
      }
    });

    // Player left debate
    socket.on('player-left', (data) => {
      const room = debateRooms.get(data.debateId);
      if (room) {
        room.participants.delete(data.userId);
        console.log(`${data.playerName} left debate: ${data.debateId}. Remaining participants: ${room.participants.size}`);
      }
      
      io.to(data.debateId).emit('player-disconnected', {
        userId: data.userId,
        playerName: data.playerName,
        message: `${data.playerName} left the debate`,
        remainingParticipants: room ? room.participants.size : 0
      });
    });

    // Video ready - user is ready to stream video
    socket.on('video-ready', (data) => {
      socket.broadcast.to(data.debateId).emit('video-ready', {
        userId: data.userId,
        playerName: data.playerName
      });
      
      console.log(`${data.playerName} (${data.userId}) video ready in ${data.debateId}`);
    });

    // WebRTC signaling - relay offer/answer/ICE candidates
    socket.on('signal', (data) => {
      io.to(data.debateId).emit('signal', {
        fromUserId: data.fromUserId,
        toUserId: data.toUserId,
        signal: data.signal
      });
    });

    // Get room participants
    socket.on('get-participants', (data) => {
      const room = debateRooms.get(data.debateId);
      if (room) {
        const participants = Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName
        }));
        socket.emit('participants-list', {
          participants: participants,
          count: participants.length
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      // Find and remove user from all rooms
      debateRooms.forEach((room, debateId) => {
        for (const [userId, participant] of room.participants) {
          if (participant.socketId === socket.id) {
            room.participants.delete(userId);
            
            io.to(debateId).emit('player-disconnected', {
              userId: userId,
              playerName: participant.playerName,
              message: `${participant.playerName} disconnected`,
              remainingParticipants: room.participants.size
            });
            
            console.log(`${participant.playerName} disconnected from ${debateId}`);
            break;
          }
        }
        
        // Clean up empty rooms
        if (room.participants.size === 0) {
          debateRooms.delete(debateId);
        }
      });
    });
  });
};
