const { v4: uuidv4 } = require('uuid');

// In-memory storage (can be replaced with database later)
const rooms = new Map();
const debates = new Map();
const users = new Map();
const waitingPlayers = [];

// Room Model
class Room {
  constructor(topic = null, maxPlayers = 4, roomType = 'user-only') {
    this.id = uuidv4();
    this.code = generateRoomCode();
    this.topic = topic;
    this.maxPlayers = maxPlayers;
    this.roomType = roomType; // 'ai' for AI debates, 'user-only' for user vs user
    this.players = [];
    this.status = 'waiting'; // waiting, active, completed
    this.createdAt = new Date();
  }

  addPlayer(player) {
    if (this.players.length < this.maxPlayers) {
      this.players.push(player);
      return true;
    }
    return false;
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
  }

  isFull() {
    return this.players.length >= this.maxPlayers;
  }
}

// Debate Model
class Debate {
  constructor(roomId, topic, players, roomType = 'user-only') {
    this.id = uuidv4();
    this.roomId = roomId;
    this.topic = topic;
    this.players = players;
    this.roomType = roomType; // 'ai' for AI debates, 'user-only' for user vs user
    this.messages = [];
    this.status = 'active'; // active, completed
    this.startTime = new Date();
    this.endTime = null;
    this.scores = {};
    
    players.forEach(player => {
      this.scores[player.id] = {
        communication: 0,
        logic: 0,
        confidence: 0,
        rebuttal: 0
      };
    });
  }

  addMessage(userId, message) {
    this.messages.push({
      userId,
      message,
      timestamp: new Date()
    });
  }

  setScores(userId, scores) {
    if (this.scores[userId]) {
      this.scores[userId] = scores;
    }
  }
}

// User Model
class User {
  constructor(name = 'Anonymous') {
    this.id = uuidv4();
    this.name = name;
    this.avatar = generateAvatar(name);
    this.rating = 1000;
    this.debatesPlayed = 0;
    this.createdAt = new Date();
  }
}

module.exports = {
  Room,
  Debate,
  User,
  rooms,
  debates,
  users,
  waitingPlayers
};

// Helper functions (will be in utils folder)
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateAvatar(name) {
  const colors = ['FF6B6B', '4ECDC4', '45B7D1', 'FFA07A', '98D8C8'];
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  return `https://ui-avatars.com/api/?name=${initials}&background=${randomColor}&color=fff`;
}
