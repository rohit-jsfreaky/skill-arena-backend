
import { Server } from 'socket.io';
import { pool } from '../db/db.js';

let io;

export const initializeSocketIO = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO has not been initialized');
  }
  return io;
};



export const chatSocketsManager = () => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Join global chat room
    socket.join("global");

    let currentUserId = null;

    socket.on("authenticate", (userId) => {
      currentUserId = userId;
      // Join a personal room with the user's ID
      socket.join(`user:${userId}`);
      console.log(`User ${userId} authenticated on socket ${socket.id}`);
    });

    // Handle incoming messages
    socket.on("chat_message", async (data) => {
      try {
        // Save message to database
        const { userId, message } = data;
        const result = await pool.query(
          "INSERT INTO chat_messages (user_id, message) VALUES ($1, $2) RETURNING *",
          [userId, message]
        );

        // Get user info
        const userInfo = await pool.query(
          "SELECT username FROM users WHERE id = $1",
          [userId]
        );
        const username = userInfo.rows[0]?.username || "Unknown User";

        // Broadcast message to all users in global room
        io.to("global").emit("chat_message", {
          id: result.rows[0].id,
          userId,
          username,
          message,
          timestamp: result.rows[0].timestamp,
          isSystem: false,
        });
      } catch (error) {
        console.error("Error saving/broadcasting message:", error);
        socket.emit("error", "Failed to send message");
      }
    });

    // Handle typing indicators
    socket.on("typing", (data) => {
      socket.to("global").emit("typing", data);
    });

    socket.on("personal_message", async (data) => {
      try {
        const { senderId, receiverId, message } = data;

        // Validate sender
        if (currentUserId !== senderId) {
          return socket.emit("error", "Authentication error");
        }

        // Save message to database
        const result = await pool.query(
          "INSERT INTO personal_messages (sender_id, receiver_id, message) VALUES ($1, $2, $3) RETURNING *",
          [senderId, receiverId, message]
        );

        const savedMessage = result.rows[0];

        // Get sender user info
        const senderInfo = await pool.query(
          "SELECT username FROM users WHERE id = $1",
          [senderId]
        );
        const senderUsername = senderInfo.rows[0]?.username || "Unknown User";

        // Create message object
        const messageObject = {
          id: savedMessage.id,
          senderId,
          senderUsername,
          receiverId,
          message,
          timestamp: savedMessage.timestamp,
          isRead: savedMessage.is_read,
        };

        // Send to sender's socket
        socket.emit("personal_message", messageObject);

        // Send to receiver's socket (if online)
        socket.to(`user:${receiverId}`).emit("personal_message", messageObject);
      } catch (error) {
        console.error("Error handling personal message:", error);
        socket.emit("error", "Failed to send personal message");
      }
    });

    socket.on("mark_messages_read", async (data) => {
      try {
        const { userId, senderId } = data;

        // Validate user
        if (currentUserId !== userId) {
          return socket.emit("error", "Authentication error");
        }

        // Mark messages as read
        await pool.query(
          "UPDATE personal_messages SET is_read = TRUE WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE",
          [userId, senderId]
        );

        // Notify sender that messages were read
        socket.to(`user:${senderId}`).emit("messages_read", { by: userId });
      } catch (error) {
        console.error("Error marking messages as read:", error);
      }
    });

    socket.on("personal_typing", (data) => {
      const { senderId, receiverId, isTyping } = data;
      socket.to(`user:${receiverId}`).emit("personal_typing", {
        userId: senderId,
        isTyping,
      });
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

}