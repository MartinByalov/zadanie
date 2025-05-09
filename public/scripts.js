window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === '1') {
      const messageDiv = document.getElementById('message');
      messageDiv.style.display = 'block';
  
      setTimeout(() => {
        messageDiv.style.display = 'none';
      }, 3000);
  
      window.history.replaceState({}, document.title, '/');
    }
  });
  