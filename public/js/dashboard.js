// Dashboard JavaScript

// Auto-refresh dashboard data every 30 seconds
let refreshInterval;

function startAutoRefresh() {
  refreshInterval = setInterval(refreshDashboardData, 30000); // 30 seconds
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
      updateDashboard(data);
    }
  } catch (error) {
    console.error('Error refreshing dashboard:', error);
  }
}

function updateDashboard(data) {
  // This would update the dashboard with fresh data
  // For simplicity, we'll just log it
  console.log('Dashboard data refreshed:', data);
}

// View transcript modal
function viewTranscript(absenceId) {
  fetch(`/api/calls?employee_id=${absenceId}`)
    .then(res => res.json())
    .then(data => {
      const absence = data.calls.find(c => c._id === absenceId);
      if (absence && absence.call_transcript) {
        showModal('Transcript', absence.call_transcript);
      } else {
        alert('Transcript not available');
      }
    })
    .catch(err => {
      console.error('Error loading transcript:', err);
      alert('Error loading transcript');
    });
}

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
  viewTranscript,
  showModal,
  validatePhone,
  validateEmail
};
