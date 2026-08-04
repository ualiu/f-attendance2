const mongoose = require('mongoose');

/**
 * A shift-coverage offer: created when an employee reports a full-day
 * absence, broadcast to department peers, and walked through a small state
 * machine to a terminal outcome. Every transition below is performed via
 * findOneAndUpdate() guarded on the CURRENT status (see services/coverageService.js),
 * which makes each transition atomic and makes the whole flow safe against
 * concurrent replies (e.g. two candidates texting YES at once).
 *
 *   open -> claimed -> approved
 *        -> claimed -> declined_by_manager
 *        -> unfilled   (expiry sweep, or every candidate declined)
 *        -> cancelled  (absence corrected/removed)
 *        -> send_failed (every broadcast send failed, or zero candidates existed)
 *
 * `claimed` never auto-expires in v1 - it stays visible on the dashboard,
 * highlighted, until the manager acts (via SMS or the dashboard).
 */
const shiftOfferSchema = new mongoose.Schema({
  organization_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  absence_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Absence',
    required: true
  },

  // Snapshot, not a live reference - outbound texts must stay stable even if
  // the employee record is edited or deleted after the offer goes out.
  absent_employee: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    name: String,
    shift: String, // 'Day' | 'Night' | 'Weekend'
    department: String
  },

  date: {
    type: Date, // UTC midnight, via smsService.resolveAbsenceDate
    required: true
  },

  // Display fields, frozen at creation so every text sent about this offer
  // (to candidates, to the manager, on re-notify) says the same thing.
  day_label: String,   // 'today' | 'tomorrow' | 'Tuesday'
  shift_start: String, // '7:00 AM'
  shift_end: String,   // '3:00 PM'
  reason_label: String, // coarse only: 'sick' | 'personal' - never the free-text reason

  status: {
    type: String,
    enum: ['open', 'claimed', 'approved', 'declined_by_manager', 'unfilled', 'cancelled', 'send_failed'],
    default: 'open',
    index: true
  },

  candidates: [{
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    name: String,
    phone: String,        // as stored on Employee, for sending
    phone_last10: String, // normalized - indexed exact-match webhook lookup
    offered_at: Date,
    response: {
      type: String,
      enum: ['pending', 'declined', 'claimed', 'too_late'],
      default: 'pending'
    },
    responded_at: { type: Date, default: null }
  }],

  claimed_by: {
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    name: { type: String, default: null },
    phone: { type: String, default: null },
    at: { type: Date, default: null }
  },

  manager: {
    supervisor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supervisor', default: null },
    name: { type: String, default: null },
    phone: { type: String, default: null },
    phone_last10: { type: String, default: null },
    notified_at: { type: Date, default: null },
    responded_at: { type: Date, default: null },
    response: { type: String, enum: ['approved', 'declined', null], default: null },
    via: { type: String, enum: ['sms', 'dashboard', null], default: null }
  },
  // True when no supervisor/super-admin phone could be resolved - the offer
  // can only be approved from the dashboard, and the UI should highlight it.
  needs_dashboard_approval: {
    type: Boolean,
    default: false
  },

  trigger: {
    type: String,
    enum: ['sms_auto', 'manual'],
    default: 'sms_auto'
  },

  expires_at: {
    type: Date,
    required: true
  },

  send_errors: [{
    phone: String,
    error: String,
    at: Date
  }]
}, {
  timestamps: true
});

// Dashboard listing and the "does an offer already exist" guard in startCoverage
shiftOfferSchema.index({ organization_id: 1, status: 1 });
shiftOfferSchema.index({ organization_id: 1, createdAt: -1 });
// Expiry sweep
shiftOfferSchema.index({ status: 1, expires_at: 1 });
// Webhook routing - exact match, no regex scan
shiftOfferSchema.index({ 'candidates.phone_last10': 1, status: 1 });
shiftOfferSchema.index({ 'manager.phone_last10': 1, status: 1 });
// Correction hook (cancel any offer tied to a corrected/removed absence)
shiftOfferSchema.index({ absence_id: 1 });

module.exports = mongoose.model('ShiftOffer', shiftOfferSchema);
