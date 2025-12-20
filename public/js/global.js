// Global JavaScript for sidebar functionality

// Toggle sidebar on mobile (open/close)
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');

  if (sidebar && overlay) {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  }
}

// Close sidebar when clicking on a link (mobile only)
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.sidebar-link, .logout-btn').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 768) {
        toggleSidebar();
      }
    });
  });
});

// Format absence type names for display
function formatAbsenceType(type) {
  const typeMap = {
    // SMS-based (automated)
    'sick': 'Sick',
    'late': 'Late',
    'personal': 'Personal',
    // Manual incidents (5 core edge cases)
    'no_sms_no_show': 'No SMS, No Show',
    'late_sms_no_show': 'Late SMS, No Show',
    'left_early_no_permission': 'Left Early, No Permission',
    'left_early_permission': 'Left Early with Permission',
    'late_in_no_sms': 'Late In, No SMS'
  };

  return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
