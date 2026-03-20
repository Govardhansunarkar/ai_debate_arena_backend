const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const PeerServer = require('peerjs-server').PeerServer;
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:3000'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:3000'
  ],
  credentials: true
}));
app.use(express.json());

// Routes
const roomRoutes = require('./routes/roomRoutes');
const debateRoutes = require('./routes/debateRoutes');
const userRoutes = require('./routes/userRoutes');

app.use('/api/rooms', roomRoutes);
app.use('/api/debates', debateRoutes);
app.use('/api/users', userRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', message: 'AI Debate Arena API is running' });
});

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to AI Debate Arena API' });
});

// Socket.IO
const debateSocket = require('./sockets/debateSocket');
debateSocket(io);

// Setup PeerJS Server on port 9000
const peerServer = PeerServer({ port: 9000, path: '/peerjs' });
console.log('🔗 PeerJS Server running on port 9000');

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 AI Debate Arena Server running on port ${PORT}`);
});

module.exports = { app, io };
