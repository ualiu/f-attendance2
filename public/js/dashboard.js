// Dashboard JavaScript

// Auto-refresh dashboard data every 60 seconds (reduced from 30 for efficiency)
let refreshInterval;
let lastUpdateTimestamp = null;

function startAutoRefresh() {
  refreshInterval = setInterval(refreshDashboardData, 60000); // 60 seconds
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}

async function refreshDashboardData() {
  try {
    const response = await fetch('/dashboard/api/data');
    if (response.ok) {
      const data = await response.json();

      // Only update if data has changed (compare timestamps)
      if (data.lastUpdated && data.lastUpdated !== lastUpdateTimestamp) {
        updateDashboard(data);
        lastUpdateTimestamp = data.lastUpdated;
      }
    }
  } catch (error) {
    console.error('Error refreshing dashboard:', error);
  }
}

function updateDashboard(data) {
  if (!data.success) return;

  // Update stats cards
  const statsCards = document.querySelectorAll('.stat-value');
  if (statsCards.length >= 4) {
    statsCards[0].textContent = data.todaysSummary.totalEmployees || 0;
    statsCards[1].textContent = data.todaysSummary.presentCount || 0;
    statsCards[2].textContent = data.todaysSummary.absentCount || 0;
    statsCards[3].textContent = data.todaysSummary.lateCount || 0;
  }

  // Update recent absences table if data is available
  if (data.recentAbsences && data.recentAbsences.length > 0) {
    const tbody = document.querySelector('.absences-table tbody');
    if (tbody) {
      updateAbsencesTable(tbody, data.recentAbsences);
    }
  }

  console.log('Dashboard updated at:', new Date(data.lastUpdated).toLocaleTimeString());
}

function updateAbsencesTable(tbody, absences) {
  // Clear existing rows
  tbody.innerHTML = '';

  if (absences.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-data">No recent reports</td></tr>';
    return;
  }

  // Add new rows
  absences.forEach(absence => {
    const row = document.createElement('tr');

    // Time cell
    const timeCell = document.createElement('td');
    timeCell.className = 'date-time-cell';
    timeCell.setAttribute('data-timestamp', absence.report_time || '');
    if (absence.report_time && typeof formatDateTimeWithTimezone === 'function') {
      timeCell.textContent = formatDateTimeWithTimezone(absence.report_time);
    } else {
      timeCell.textContent = absence.report_time ? new Date(absence.report_time).toLocaleString() : 'N/A';
    }

    // Employee cell
    const employeeCell = document.createElement('td');
    const employeeLink = document.createElement('a');
    employeeLink.href = `/dashboard/employee/${absence.employee_id?._id || absence.employee_id}`;
    employeeLink.textContent = absence.employee_name;
    employeeCell.appendChild(employeeLink);

    // Type cell
    const typeCell = document.createElement('td');
    const typeBadge = document.createElement('span');
    typeBadge.className = `type-badge type-${absence.type}`;
    typeBadge.textContent = typeof formatAbsenceType === 'function' ? formatAbsenceType(absence.type) : absence.type;
    typeCell.appendChild(typeBadge);

    // Reason cell
    const reasonCell = document.createElement('td');
    reasonCell.textContent = absence.reason || '';

    // Actions cell
    const actionsCell = document.createElement('td');
    if (absence.report_message) {
      const viewButton = document.createElement('button');
      viewButton.className = 'btn-small';
      viewButton.textContent = 'View SMS';
      viewButton.onclick = () => viewMessage(absence._id);
      actionsCell.appendChild(viewButton);
    }

    // Append cells to row
    row.appendChild(timeCell);
    row.appendChild(employeeCell);
    row.appendChild(typeCell);
    row.appendChild(reasonCell);
    row.appendChild(actionsCell);

    tbody.appendChild(row);
  });
}

// View message modal
async function viewMessage(absenceId) {
  try {
    const response = await fetch(`/api/absences/${absenceId}`);
    if (!response.ok) throw new Error('Failed to fetch message');

    const data = await response.json();

    if (data.success && data.absence.report_message) {
      showModal('Report Message', data.absence.report_message);
    } else {
      alert('Message not available for this report');
    }
  } catch (err) {
    console.error('Error loading message:', err);
    alert('Error loading message');
  }
}

// Backwards compatibility
const viewTranscript = viewMessage;

function showModal(title, content) {
  // Create a simple modal
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${title}</h2>
      <div style="white-space: pre-wrap; max-height: 400px; overflow-y: auto; padding: 1rem; background-color: #f5f5f5; border-radius: 4px;">
        ${content}
      </div>
      <div class="modal-actions">
        <button onclick="this.closest('.modal').remove()" class="btn btn-secondary">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Initialize on page load
if (window.location.pathname === '/dashboard') {
  document.addEventListener('DOMContentLoaded', () => {
    startAutoRefresh();

    // Stop refresh when leaving page
    window.addEventListener('beforeunload', stopAutoRefresh);
  });
}

// Highlight active sidebar link
document.addEventListener('DOMContentLoaded', () => {
  const currentPath = window.location.pathname;
  const links = document.querySelectorAll('.sidebar-link');

  links.forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });
});

// Form validation helpers
function validatePhone(phone) {
  const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
  return phoneRegex.test(phone);
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Export for use in other scripts
window.FeltonAttendance = {
  refreshDashboardData,
  viewMessage,
  viewTranscript,
  showModal,
  validatePhone,
  validateEmail
};
