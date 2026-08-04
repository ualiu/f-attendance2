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

  // NOTE: `collected_info` must stay a NESTED PATH, not a String field.
  // It only stays nested because `collected_info.type` is an object literal
  // rather than a bare SchemaType. Do NOT "simplify" `type: { type: String }`
  // to `type: String` - Mongoose would then treat collected_info as a String.
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
    },
    date: {
      type: String, // "today" | "tomorrow" | "Monday".."Sunday" | specific date
      default: null
    }
  },

  last_question_asked: {
    type: String,
    default: null
  },

  // After an absence is logged we keep the conversation alive (rather than
  // deleting it) so the employee can reply to correct a wrong record while the
  // 15-minute window is still open.
  status: {
    type: String,
    enum: ['collecting', 'logged'],
    default: 'collecting'
  },
  last_absence_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Absence',
    default: null
  },
  last_absence_summary: {
    type: String, // human-readable, shown back to the LLM as context
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
