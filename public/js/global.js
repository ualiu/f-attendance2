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
