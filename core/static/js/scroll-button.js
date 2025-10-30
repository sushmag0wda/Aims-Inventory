// Smart Scroll Button - Universal
// Add this to any page for smart scroll functionality

function addSmartScrollButton() {
  // Remove existing button if any
  document.querySelectorAll('.smart-scroll-btn').forEach(btn => btn.remove());
  
  // Create single smart button
  const scrollBtn = document.createElement('button');
  scrollBtn.className = 'smart-scroll-btn';
  scrollBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
  scrollBtn.style.cssText = `
    position: fixed;
    bottom: 25px;
    right: 25px;
    width: 45px;
    height: 45px;
    background: #F59E0B;
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
    font-size: 18px;
    z-index: 1000;
    transition: all 0.3s;
    display: none;
  `;
  
  // Hover effect
  scrollBtn.addEventListener('mouseenter', () => {
    scrollBtn.style.background = '#D97706';
    scrollBtn.style.transform = 'scale(1.15)';
    scrollBtn.style.boxShadow = '0 6px 16px rgba(245, 158, 11, 0.6)';
  });
  scrollBtn.addEventListener('mouseleave', () => {
    scrollBtn.style.background = '#F59E0B';
    scrollBtn.style.transform = 'scale(1)';
    scrollBtn.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.4)';
  });
  
  // Click handler - smart behavior
  scrollBtn.addEventListener('click', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    // If near bottom, scroll to top; otherwise scroll to bottom
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  });
  
  // Update button based on scroll position
  window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    // Show button if scrolled down
    if (scrollTop > 300) {
      scrollBtn.style.display = 'block';
    } else {
      scrollBtn.style.display = 'none';
    }
    
    // Change icon based on position
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      scrollBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
    } else {
      scrollBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
    }
  });
  
  document.body.appendChild(scrollBtn);
}

// Auto-initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addSmartScrollButton);
} else {
  addSmartScrollButton();
}
