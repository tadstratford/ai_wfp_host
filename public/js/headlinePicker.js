// Rotate headline on page refresh
(function () {
  var phrases = [
    'AI-driven workflows',
    'Automate your finance work',
    'Your AI accounting assistant',
    'Build once, run every month',
    'AI workflows for accountants',
  ];
  var el = document.getElementById('hero-headline');
  if (el) el.textContent = phrases[Math.floor(Math.random() * phrases.length)];
})();
