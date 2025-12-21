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

// Toggle user dropdown menu
function toggleUserMenu(event) {
  event.stopPropagation(); // Prevent event from bubbling
  const dropdown = document.getElementById('userDropdown');

  if (dropdown) {
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('userDropdown');
  const userInfo = document.querySelector('.user-info');

  if (dropdown && userInfo && !userInfo.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

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

// Update organization timezone clock
function updateOrganizationClock() {
  const timezone = window.ORG_TIMEZONE || 'America/New_York';
  const timeElement = document.getElementById('orgCurrentTime');
  const dateElement = document.getElementById('orgCurrentDate');
  const tzNameElement = document.getElementById('orgTimezoneName');

  if (!timeElement || !dateElement || !tzNameElement) return;

  const now = new Date();

  // Format time
  const timeOptions = {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  const timeFormatter = new Intl.DateTimeFormat('en-US', timeOptions);
  timeElement.textContent = timeFormatter.format(now);

  // Format date
  const dateOptions = {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  };
  const dateFormatter = new Intl.DateTimeFormat('en-US', dateOptions);
  dateElement.textContent = dateFormatter.format(now);

  // Format timezone name
  const tzNames = {
    'America/New_York': 'Eastern Time',
    'America/Chicago': 'Central Time',
    'America/Denver': 'Mountain Time',
    'America/Phoenix': 'Arizona Time',
    'America/Los_Angeles': 'Pacific Time',
    'America/Anchorage': 'Alaska Time',
    'Pacific/Honolulu': 'Hawaii Time',
    'America/Halifax': 'Atlantic Time',
    'America/Toronto': 'Eastern (CA)',
    'America/Winnipeg': 'Central (CA)',
    'America/Edmonton': 'Mountain (CA)',
    'America/Vancouver': 'Pacific (CA)'
  };
  tzNameElement.textContent = tzNames[timezone] || timezone;
}

// Initialize and update clock on page load
document.addEventListener('DOMContentLoaded', function() {
  // Update clock immediately
  updateOrganizationClock();

  // Update every second
  setInterval(updateOrganizationClock, 1000);
});
