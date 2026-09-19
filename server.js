const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ORDERS_FILE = process.env.VERCEL ? "/tmp/orders.json" : path.join(__dirname, "orders.json");
const MENU_FILE = process.env.VERCEL ? "/tmp/menu.json" : path.join(__dirname, "menu.json");

let ordersMemory = [];
let menuMemory = null;

function readOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const raw = fs.readFileSync(ORDERS_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return ordersMemory;
}

function writeOrders(orders) {
  ordersMemory = orders;
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
  } catch (e) {}
}

function readMenu() {
  if (menuMemory) return menuMemory;
  try {
    if (fs.existsSync(MENU_FILE)) {
      const raw = fs.readFileSync(MENU_FILE, "utf8");
      menuMemory = JSON.parse(raw);
      return menuMemory;
    }
  } catch (e) {}
  return null;
}

function writeMenu(data) {
  menuMemory = data;
  try {
    fs.writeFileSync(MENU_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {}
}

app.use(express.json({ limit: "5mb" }));

// CORS headers for local/cross-origin/mobile requests
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Menü API (Admin <-> Mobil QR Menü Senkronizasyonu)
const DEFAULT_MENU = {
  cafeName: "web-sitesi-ornek-sablon",
  slogan: "Örnek Menü & Sipariş Şablonu",
  categories: [
    { id: "hot-drinks", name: "Sıcak İçecekler", icon: "☕" },
    { id: "cold-drinks", name: "Soğuk İçecekler", icon: "❄️" },
    { id: "bakery", name: "Fırın & Unlu Mamul", icon: "🥐" },
    { id: "dessert", name: "Tatlılar", icon: "🍰" },
    { id: "sandwich", name: "Sandviç & Tost", icon: "🥪" }
  ],
  products: [
    { id: "p_1", name: "Özel Harman Çay", category: "hot-drinks", price: 95, desc: "Geleneksel demleme harman çay.", active: true },
    { id: "p_2", name: "Bitki & Meyve Çayı", category: "hot-drinks", price: 90, desc: "Doğal kurutulmuş bitki harmanı.", active: true },
    { id: "p_3", name: "Klasik Latte", category: "hot-drinks", price: 120, desc: "Taze espresso ve kadifemsi süt köpüğü.", active: true },
    { id: "p_4", name: "Filtre Kahve", category: "hot-drinks", price: 85, desc: "Taze çekilmiş günlük filtre kahve.", active: true },
    { id: "p_5", name: "Buzlu Karamel Latte", category: "cold-drinks", price: 125, desc: "Soğuk süt, espresso ve karamel aroması.", active: true },
    { id: "p_6", name: "Ev Yapımı Limonata", category: "cold-drinks", price: 95, desc: "Taze limon ve nane yaprakları ile.", active: true },
    { id: "p_7", name: "Tereyağlı Kruvasan", category: "bakery", price: 110, desc: "Geleneksel Fransız usulü çıtır kruvasan.", active: true },
    { id: "p_8", name: "San Sebastian Cheesecake", category: "dessert", price: 155, desc: "Kremamsı dokusu ve çikolata sosu ile.", active: true },
    { id: "p_9", name: "Gurme Kaşarlı Tost", category: "sandwich", price: 130, desc: "Ekşi maya ekmeği ve çift kaşar peyniri.", active: true }
  ]
};

app.get("/api/menu", (req, res) => {
  const menu = readMenu();
  res.json(menu || DEFAULT_MENU);
});

app.post("/api/menu", (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.products)) {
    return res.status(400).json({ error: "Geçersiz menü verisi." });
  }
  writeMenu(data);
  res.json({ success: true, count: data.products.length });
});

app.get("/api/orders", (req, res) => {
  const status = req.query.status;
  const table = req.query.table;
  let orders = readOrders();

  if (table) {
    const tableStr = String(table).trim();
    orders = orders.filter((o) => String(o.table).trim() === tableStr);
  }

  if (status && status !== "all") {
    orders = orders.filter((o) => o.status === status);
  } else if (!status) {
    orders = orders.filter((o) => o.status !== "done" && o.status !== "cancelled");
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

  const orders = readOrders();
  const tableStr = String(table).trim();

  // Aynı masanın aktif (done veya cancelled olmayan) siparişini bul
  const existingIdx = orders.findIndex(
    (o) => String(o.table).trim() === tableStr && o.status !== "done" && o.status !== "cancelled"
  );

  if (existingIdx !== -1) {
    // Mevcut siparişe yeni ürünleri ekle
    const existing = orders[existingIdx];

    // Önceki ürünlerin isNew işaretini kaldır
    existing.items.forEach((item) => {
      item.isNew = false;
    });

    // Yeni gelen siparişleri isNew: true olarak ekle
    cleanItems.forEach((newItem) => {
      existing.items.push({
        name: newItem.name,
        price: newItem.price,
        qty: newItem.qty,
        isNew: true,
      });
    });

    // Not varsa ekle / güncelle
    if (note && String(note).trim()) {
      const newNote = String(note).trim().slice(0, 200);
      existing.note = existing.note
        ? `${existing.note} | ${newNote}`
        : newNote;
    }
    existing.status = "new";
    existing.hasNewItems = true;
    existing.updatedAt = new Date().toISOString();
    writeOrders(orders);
    return res.status(200).json(existing);
  }

  // Aktif sipariş yok → yeni sipariş oluştur
  const order = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    table: tableStr,
    items: cleanItems.map((i) => ({ ...i, isNew: false })),
    note: note ? String(note).trim().slice(0, 200) : "",
    status: "new",
    customerRequests: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  orders.push(order);
  writeOrders(orders);

  res.status(201).json(order);
});

app.patch("/api/orders/:id", (req, res) => {
  const { status, action, itemIndex, cancelQty, newItem, setStatus, type, targetItem, note, requestId } = req.body || {};
  const allowed = ["new", "preparing", "ready", "delivered", "done", "cancelled"];

  const orders = readOrders();
  const index = orders.findIndex((o) => o.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "Sipariş bulunamadı." });
  }

  const order = orders[index];
  if (!order.customerRequests) order.customerRequests = [];

  // Aksiyon kontrolü
  if (action === "cancel-item") {
    const idx = Number(itemIndex);
    if (isNaN(idx) || idx < 0 || idx >= order.items.length) {
      return res.status(400).json({ error: "Geçersiz ürün indeksi." });
    }

    const item = order.items[idx];
    const qtyToCancel = Number(cancelQty) || item.qty;

    if (qtyToCancel < item.qty) {
      item.qty -= qtyToCancel;
    } else {
      order.items.splice(idx, 1);
    }

    // İlgili müşteri talebi varsa çözüldü yap
    order.customerRequests.forEach((r) => {
      if (r.itemName === item.name && !r.resolved) {
        r.resolved = true;
      }
    });

    if (order.items.length === 0) {
      order.status = "cancelled";
    }

    order.updatedAt = new Date().toISOString();
    writeOrders(orders);
    return res.json(order);
  }

  if (action === "exchange-item") {
    const idx = Number(itemIndex);
    if (isNaN(idx) || idx < 0 || idx >= order.items.length) {
      return res.status(400).json({ error: "Geçersiz ürün indeksi." });
    }
    if (!newItem || !newItem.name) {
      return res.status(400).json({ error: "Yeni ürün bilgisi gerekli." });
    }

    const oldItemName = order.items[idx].name;
    const currentQty = order.items[idx].qty;

    order.items[idx] = {
      name: String(newItem.name).trim(),
      price: Number(newItem.price) || 0,
      qty: Number(newItem.qty) || currentQty,
      isNew: true,
      exchangedFrom: oldItemName,
    };

    // Talep varsa çözüldü yap
    order.customerRequests.forEach((r) => {
      if (r.itemName === oldItemName && !r.resolved) {
        r.resolved = true;
      }
    });

    if (setStatus && allowed.includes(setStatus)) {
      order.status = setStatus;
    }

    order.updatedAt = new Date().toISOString();
    writeOrders(orders);
    return res.json(order);
  }

  if (action === "customer-request") {
    const newReq = {
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: type === "cancel" ? "cancel" : "exchange",
      itemIndex: Number(itemIndex),
      itemName: String(req.body.itemName || (order.items[itemIndex] ? order.items[itemIndex].name : "")).trim(),
      targetItem: String(targetItem || "").trim(),
      note: String(note || "").trim().slice(0, 200),
      createdAt: new Date().toISOString(),
      resolved: false,
    };

    order.customerRequests.push(newReq);
    order.hasCustomerRequest = true;
    order.updatedAt = new Date().toISOString();
    writeOrders(orders);
    return res.status(201).json(order);
  }

  if (action === "resolve-request") {
    if (requestId) {
      const target = order.customerRequests.find((r) => r.id === requestId);
      if (target) target.resolved = true;
    } else {
      order.customerRequests.forEach((r) => { r.resolved = true; });
    }
    order.hasCustomerRequest = order.customerRequests.some((r) => !r.resolved);
    order.updatedAt = new Date().toISOString();
    writeOrders(orders);
    return res.json(order);
  }

  if (action === "cancel-order") {
    order.status = "cancelled";
    order.updatedAt = new Date().toISOString();
    writeOrders(orders);
    return res.json(order);
  }

  // Standart durum güncellemesi
  if (status) {
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Geçersiz durum." });
    }
    order.status = status;
    order.updatedAt = new Date().toISOString();
    writeOrders(orders);
    return res.json(order);
  }

  writeOrders(orders);
  res.json(order);
});

app.use(express.static(__dirname));

// Vercel ortamında değilsek sunucuyu dinle
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`web-sitesi-ornek-sablon → http://localhost:${PORT}`);
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
}

// Vercel için uygulamayı dışa aktar
module.exports = app;
