const express = require('express');
const path = require('path');
function createApp(config) {
const app = express();
app.get('/health/live', (req, res) => res.json({ status: 'live' }));
app.get('/runtime-config.js', (req, res) => {
  res.set('Cache-Control', 'no-store').type('application/javascript')
    .send('window.AppConfig = Object.freeze(' + JSON.stringify(config.public).replace(/</g, '\\u003c') + ');');
});
app.get('/vendor/socket.io.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/socket.io-client/dist/socket.io.min.js'));
});

app.get('/vendor/dompurify.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/dompurify/dist/purify.min.js'));
});

// serve static folder
app.use(express.static(path.join(__dirname, 'public')));

// routing "ngắn gọn" cho HTML
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','pages', 'login.html'));
});

app.get('/shop', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','pages', 'shop.html'));
});

app.get('/cart', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','pages', 'cart.html'));
});

app.get("/checkout", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages/checkout.html"));
});

app.get("/search", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages/search.html"));
});

app.get("/account", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages/account.html"));
});

app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages/payment-result.html"));
});
app.get("/fail", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages/payment-result.html"));
});
app.get("/payment-result", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages/payment-result.html"));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','pages', 'index.html'));
});


// ===================
// ADMIN ROUTES
// ===================

app.get('/admin', (req, res) => {
  res.redirect('/admin/login');
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','login.html'));
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','dashboard.html'));
});

app.get('/admin/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','products.html'));
});

app.get('/admin/categories', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','categories.html'));
});

app.get('/admin/orders', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','orders.html'));
});

app.get('/admin/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','chat.html'));
});

app.get('/admin/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','users.html'));
});

app.get('/admin/banners', (req, res) => {
  res.sendFile(path.join(__dirname, 'public','admin','banners.html'));
});

app.get('/:slug', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'pages', 'product-detail.html')
  );
});

return app;
}
function start(env = process.env) {
  const config = require('./config')(env);
  const app = createApp(config);
  const server = app.listen(config.port, config.host, () => console.log('Frontend ready on port ' + server.address().port));
  return server;
}
module.exports = { createApp, start };
if (require.main === module) {
  if (!process.env.BACKEND_URL && require('node:fs').existsSync('.env')) process.loadEnvFile('.env');
  try { start(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
