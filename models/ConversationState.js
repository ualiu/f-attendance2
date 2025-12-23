const mongoose = require('mongoose');

const conversationStateSchema = new mongoose.Schema({
  phone_number: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  messages: [{
    text: String,
    timestamp: Date
  }],

  collected_info: {
    type: {
      type: String, // late, short_absence, half_day, full_day
      default: null
    },
    subtype: {
      type: String, // sick, personal
      default: null
    },
    reason: {
      type: String,
      default: null
    },
    duration_minutes: {
      type: Number,
      default: null
    }
  },

  last_question_asked: {
    type: String,
    default: null
  },

  transcript: [{
    from: {
      type: String,
      enum: ['employee', 'system']
    },
    message: String,
    timestamp: Date
  }],

  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },

  expires_at: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// TTL index - MongoDB will automatically delete documents after expires_at
conversationStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ConversationState', conversationStateSchema);
