// Builds public/vendor/app.css from the classes used in public/index.html.
// Rebuild after changing classes: npm run build:css
module.exports = {
  darkMode: 'class',
  content: [__dirname + '/../public/index.html'],
  theme: { extend: { fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] } } },
};
