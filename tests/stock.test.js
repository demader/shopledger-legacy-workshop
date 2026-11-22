// Ticket #2: cannot sell the last sellable unit, and cancelling an order never restores stock.
// Characterization tests for lib/inventory.js and lib/orders.js cancel().
// In-memory fixtures only: never data/db.json.

var test = require('node:test');
var assert = require('node:assert/strict');

var inventory = require('../lib/inventory');
var orders = require('../lib/orders');

function products() {
  return [
    { id: 4, sku: 'OIL-001', name: 'Cold-Pressed Sunflower Oil 1L', hsn: '1512', price: 190, stock: 22, reserved: 4 },
    { id: 6, sku: 'DRY-001', name: 'A2 Gir Cow Ghee 500ml', hsn: '0405', price: 450, stock: 1, reserved: 0 },
    { id: 10, sku: 'GRN-004', name: 'Organic Kolhapuri Jaggery 1kg', hsn: '1701', price: 95, stock: 0, reserved: 0 },
    { id: 11, sku: 'SPC-001', name: 'Byadgi Kashmiri Chilli Powder 500g', hsn: '0904', price: 210, stock: 4, reserved: 3 }
  ];
}

function db() {
  return {
    products: products(),
    customers: [
      { id: 4, name: 'Suresh Deshmukh', creditLimit: 15000, openingBalance: 1200, totalBilled: 1407, totalSettled: 1000, balance: 1607 }
    ],
    orders: [
      { id: 1007, date: '04/03/2022', customer: 'Suresh Deshmukh', customerId: 4, paymentMode: 'khata', status: 'pending',
        items: [
          { id: 6, sku: 'DRY-001', name: 'A2 Gir Cow Ghee 500ml', hsn: '0405', price: 450, qty: 2 },
          { id: 4, sku: 'OIL-001', name: 'Cold-Pressed Sunflower Oil 1L', hsn: '1512', price: 190, qty: 2 }
        ],
        coupon: '', subtotal: 1280, discount: 0, tax: 127, total: 1407 }
    ]
  };
}

function stockOf(d, id) { return inventory.find(d.products, id).stock; }

test('sellable stock is physical stock minus wholesale reservations', function () {
  var p = products();
  assert.equal(inventory.getSellableStock(p[1]), 1);  // DRY-001
  assert.equal(inventory.getSellableStock(p[3]), 1);  // SPC-001: 4 - 3
  assert.equal(inventory.getSellableStock(p[2]), 0);  // GRN-004
});

test('check() accepts a quantity below sellable stock', function () {
  assert.deepEqual(inventory.check(products(), [{ id: 4, qty: 5 }]), { ok: true });
});

test('check() rejects an unknown product', function () {
  assert.deepEqual(inventory.check(products(), [{ id: 99, qty: 1 }]), { ok: false, msg: 'Unknown product 99' });
});

test('check() rejects a quantity above sellable stock', function () {
  var r = inventory.check(products(), [{ id: 11, qty: 2 }]);
  assert.equal(r.ok, false);
  assert.equal(r.msg, 'Byadgi Kashmiri Chilli Powder 500g is out of stock (1 sellable available)');
});

// Updated after the Ticket #2 fix: these pinned the old off-by-one (qty >= sellable).
test('check() allows buying the last sellable unit of DRY-001', function () {
  assert.deepEqual(inventory.check(products(), [{ id: 6, qty: 1 }]), { ok: true });
});

test('check() allows buying the last sellable unit of SPC-001 (4 physical, 3 reserved)', function () {
  assert.equal(inventory.check(products(), [{ id: 11, qty: 1 }]).ok, true);
});

test('check() allows buying exactly the remaining sellable stock of any SKU', function () {
  assert.equal(inventory.check(products(), [{ id: 4, qty: 18 }]).ok, true); // 22 - 4 = 18 sellable
});

test('reserve() deducts ordered quantities from physical stock', function () {
  var p = products();
  inventory.reserve(p, [{ id: 4, qty: 3 }]);
  assert.equal(p[0].stock, 19);
  assert.equal(p[0].reserved, 4);
});

test('release() (wholesale quote helper) frees reserved units by productId', function () {
  var p = products();
  inventory.release(p, [{ productId: 11, qty: 2 }]);
  assert.equal(p[3].reserved, 1);
  assert.equal(p[3].stock, 4);
});

test('cancel() marks the order cancelled and reverses the Khata debit', function () {
  var d = db();
  var r = orders.cancel(d, 1007, 'Customer changed mind');
  assert.equal(r.ok, true);
  assert.equal(r.order.status, 'cancelled');
  assert.equal(r.order.cancelReason, 'Customer changed mind');
  assert.equal(d.customers[0].totalBilled, 0);
  assert.equal(d.customers[0].balance, 200);
});

// Updated after the Ticket #2 fix: this pinned stock never coming back on cancel.
test('cancel() of pending order #1007 returns its items to stock', function () {
  var d = db();
  orders.cancel(d, 1007);
  assert.equal(stockOf(d, 6), 3);   // was 1 before the fix
  assert.equal(stockOf(d, 4), 24);  // was 22 before the fix
});

test('cancel() refuses an order that is already cancelled', function () {
  var d = db();
  orders.cancel(d, 1007);
  assert.deepEqual(orders.cancel(d, 1007), { ok: false, error: 'Order #1007 is already cancelled' });
});

test('cancel() of an unknown order returns an error', function () {
  assert.deepEqual(orders.cancel(db(), 4242), { ok: false, error: 'Order not found' });
});

// ---------------------------------------------------------------------------
// Ticket #2 — correct behaviour
// ---------------------------------------------------------------------------

test('TICKET #2: the last sellable unit of DRY-001 and SPC-001 can be sold', function () {
  assert.deepEqual(inventory.check(products(), [{ id: 6, qty: 1 }]), { ok: true });
  assert.deepEqual(inventory.check(products(), [{ id: 11, qty: 1 }]), { ok: true });
});

test('TICKET #2: buying exactly the remaining sellable stock is allowed, one more is not', function () {
  assert.deepEqual(inventory.check(products(), [{ id: 4, qty: 18 }]), { ok: true });
  assert.equal(inventory.check(products(), [{ id: 4, qty: 19 }]).ok, false);
});

test('TICKET #2: out-of-stock SKU still rejects qty 1', function () {
  var r = inventory.check(products(), [{ id: 10, qty: 1 }]);
  assert.deepEqual(r, { ok: false, msg: 'Organic Kolhapuri Jaggery 1kg is out of stock (0 sellable available)' });
});

test('TICKET #2: cancelling order #1007 returns its items to physical stock', function () {
  var d = db();
  orders.cancel(d, 1007);
  assert.equal(stockOf(d, 6), 3);   // 1 + 2 ghee
  assert.equal(stockOf(d, 4), 24);  // 22 + 2 sunflower oil
});

test('TICKET #2: cancelling does not touch wholesale reservations', function () {
  var d = db();
  orders.cancel(d, 1007);
  assert.equal(inventory.find(d.products, 4).reserved, 4);
});

test('TICKET #2: a failed second cancel does not restock twice', function () {
  var d = db();
  orders.cancel(d, 1007);
  orders.cancel(d, 1007);
  assert.equal(stockOf(d, 6), 3);
});
