const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readOrders() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
}

if (!fs.existsSync(ORDERS_FILE)) {
  writeOrders([]);
}

app.use(express.json());

app.get("/api/orders", (req, res) => {
  const status = req.query.status;
  let orders = readOrders();
  if (status) {
    orders = orders.filter((o) => o.status === status);
  } else {
    orders = orders.filter((o) => o.status !== "done");
  }
  orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json(orders);
});

app.post("/api/orders", (req, res) => {
  const { table, items, note } = req.body || {};

  if (!table || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Masa ve ürünler gerekli." });
  }

  const cleanItems = items
    .map((item) => ({
      name: String(item.name || "").trim(),
      price: Number(item.price) || 0,
      qty: Math.max(1, Number(item.qty) || 1),
    }))
    .filter((item) => item.name);

  if (!cleanItems.length) {
    return res.status(400).json({ error: "Geçerli ürün yok." });
  }

  const order = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    table: String(table).trim(),
    items: cleanItems,
    note: note ? String(note).trim().slice(0, 200) : "",
    status: "new",
    createdAt: new Date().toISOString(),
  };

  const orders = readOrders();
  orders.push(order);
  writeOrders(orders);

  res.status(201).json(order);
});

app.patch("/api/orders/:id", (req, res) => {
  const { status } = req.body || {};
  const allowed = ["new", "preparing", "ready", "done"];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Geçersiz durum." });
  }

  const orders = readOrders();
  const index = orders.findIndex((o) => o.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "Sipariş bulunamadı." });
  }

  orders[index].status = status;
  writeOrders(orders);
  res.json(orders[index]);
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Book n Tea → http://localhost:${PORT}`);
  console.log(`Kafe paneli → http://localhost:${PORT}/staff.html`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} dolu. Önce şu komutu çalıştırın, sonra tekrar npm start:\n` +
        `  npx --yes kill-port ${PORT}`
    );
    process.exit(1);
  }
  throw err;
});
